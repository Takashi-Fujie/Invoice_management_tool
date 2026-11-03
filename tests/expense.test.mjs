import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changeReward, companyTotals, normalizeRow } from "../src/reward.mjs";
import { monthSummary } from "../src/summary.mjs";
import { MonthlySummary } from "../src/MonthlySummary.tsx";
import { createApp } from "../server/app.mjs";
import {
  databaseSnapshot,
  migrateDatabase,
  restoreSnapshot,
} from "../server/migrations.mjs";
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const row = (id, rewardType, amount, priceMode = "inclusive") => ({
  id,
  description: "架空の調査経費",
  rewardType,
  amount,
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode,
  feePriceMode:
    rewardType === "expense" || rewardType === "travel"
      ? "exclusive"
      : priceMode,
  travelPriceMode:
    rewardType === "expense" || rewardType === "travel"
      ? priceMode
      : "inclusive",
  discountEnabled: true,
  discountRate: "2",
  withholdingEnabled: true,
});
const company = (rows) => ({
  id: "a",
  name: "架空調査室",
  revision: 0,
  rows,
  withholdingAmount: 100,
  invoiced: false,
  paid: false,
});
const get = async (app, month = 8) =>
  (await app.inject({ url: `/api/month/2026/${month}`, headers })).json();
const put = (app, payload) =>
  app.inject({ method: "PUT", url: "/api/month/2026/8", headers, payload });
test("S28-T01：立替経費は別集計、税は交通費と同じ、値引き対象外、手入力源泉額を維持", () => {
  const rows = [
    row("fee", "per_item", 1000, "exclusive"),
    row("expense", "expense", 770),
    row("travel", "travel", 110),
  ];
  expect(companyTotals(rows)).toMatchObject({
    invoice: 1958,
    fee: 1000,
    travel: 110,
    expense: 770,
    net: 1800,
    tax: 180,
    discount: 22,
  });
  expect(companyTotals([row("e", "expense", 55, "exclusive")])).toMatchObject({
    invoice: 60,
    expense: 55,
    fee: 0,
    travel: 0,
    tax: 5,
  });
  expect(monthSummary([company(rows)]).rows[0]).toMatchObject({
    invoice: 1858,
    gross: 1958,
    withheld: 100,
    expense: 770,
    fee: 1000,
  });
  expect(monthSummary([company(rows)]).total.expense).toBe(770);
});
test("S28-T02：立替経費と報酬・交通費・時給の往復で金額・税区分・復元条件を保持", () => {
  let r = row("r", "per_item", 770, "exclusive");
  r = changeReward(r, { rewardType: "expense" });
  expect(r).toMatchObject({
    priceMode: "inclusive",
    amount: 770,
    discountEnabled: true,
    withholdingEnabled: true,
  });
  expect(normalizeRow(r)).toEqual(r);
  r = changeReward(r, { priceMode: "exclusive" });
  r = changeReward(r, { rewardType: "travel" });
  expect(r.priceMode).toBe("exclusive");
  r = changeReward(r, { rewardType: "hourly", hours: "1.5", rate: "1001" });
  expect(r.amount).toBe(1502);
  r = changeReward(r, { priceMode: "inclusive" });
  r = changeReward(r, { rewardType: "expense" });
  expect(r).toMatchObject({
    amount: 770,
    priceMode: "exclusive",
    hours: "1.5",
    rate: "1001",
  });
  r = changeReward(r, { rewardType: "hourly" });
  expect(r).toMatchObject({
    amount: 1502,
    priceMode: "inclusive",
    discountEnabled: true,
    withholdingEnabled: true,
  });
});
test("S28-T03：立替経費の保存・再起動・月切替・ロック・不正値・競合と退避復元", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-expense-")),
    path = join(dir, "db.sqlite");
  let app = createApp({ path });
  try {
    const response = await put(app, {
      companies: [company([row("e", "expense", 770)])],
    });
    expect(response.statusCode).toBe(200);
    let saved = response.json();
    await app.close();
    app = createApp({ path });
    expect(await get(app)).toEqual(saved);
    expect((await get(app, 9)).companies[0].rows).toEqual([]);
    for (const patch of [
      { amount: -1 },
      { amount: 0.1 },
      { amount: null },
      { priceMode: "unknown" },
      { rewardType: "unknown" },
    ]) {
      const bad = structuredClone(saved);
      Object.assign(bad.companies[0].rows[0], patch);
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    const stale = structuredClone(saved);
    saved.companies[0].invoiced = true;
    saved = (await put(app, saved)).json();
    expect((await put(app, stale)).statusCode).toBe(409);
    const locked = structuredClone(saved);
    locked.companies[0].rows[0].amount = 0;
    expect((await put(app, locked)).statusCode).toBe(400);
    expect(await get(app)).toEqual(saved);
    locked.companies[0].invoiced = false;
    expect((await put(app, locked)).statusCode).toBe(200);
    const db = new DatabaseSync(path);
    const snapshot = databaseSnapshot(db),
      backup = join(dir, "saved.sqlite");
    expect(db.prepare("SELECT kind FROM invoice_lines").get().kind).toBe(
      "expense",
    );
    db.prepare("VACUUM INTO ?").run(backup);
    db.close();
    const restored = join(dir, "restored.sqlite");
    restoreSnapshot(backup, restored);
    const copy = new DatabaseSync(restored);
    expect(databaseSnapshot(copy)).toEqual(snapshot);
    copy.close();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
const files = [
  "001-mvp1.sql",
  "002-mvp2-reward.sql",
  "003-mvp2-travel.sql",
  "004-mvp2-tax.sql",
  "005-mvp2-discount.sql",
  "006-mvp2-withholding.sql",
];
function legacy(path, version) {
  const db = new DatabaseSync(path);
  for (const name of files.slice(0, version))
    db.exec(
      readFileSync(new URL("../server/" + name, import.meta.url), "utf8"),
    );
  db.exec(
    "PRAGMA foreign_keys=ON; INSERT INTO clients VALUES('a','架空調査室',4); INSERT INTO invoices(id,client_id,target_year,target_month,total_yen,invoiced,paid) VALUES('i','a',2026,8,770,1,1); INSERT INTO billable_items(id,client_id,target_year,target_month,description,amount_yen) VALUES('b','a',2026,8,'架空交通費',770); INSERT INTO invoice_lines(id,invoice_id,billable_item_id,line_no,description,total_yen) VALUES('l','i','b',0,'架空交通費',770);",
  );
  if (version >= 3)
    db.exec(
      "UPDATE billable_items SET kind='travel'; UPDATE invoice_lines SET kind='travel';",
    );
  if (version >= 6)
    db.exec(
      "UPDATE invoices SET withholding_yen=70; UPDATE billable_items SET withholding_enabled=1; UPDATE invoice_lines SET withholding_enabled=1;",
    );
  return db;
}
for (const version of [1, 2, 3, 4, 5, 6])
  test(`S28-T04：版${version}から版9への全旧列保持と退避復元・再移行`, () => {
    const dir = mkdtempSync(join(tmpdir(), "invoice-expense-migrate-")),
      path = join(dir, "db.sqlite");
    let db = legacy(path, version);
    try {
      const before = databaseSnapshot(db),
        backup = migrateDatabase(db, path),
        after = databaseSnapshot(db);
      expect(after.version).toBe(9);
      for (const [table, rows] of Object.entries(before.tables))
        for (const old of rows)
          expect(
            after.tables[table].find((r) => r.id === old.id),
          ).toMatchObject(old);
      expect(db.prepare("PRAGMA integrity_check").get().integrity_check).toBe(
        "ok",
      );
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(migrateDatabase(db, path)).toBeNull();
      db.exec(
        "UPDATE billable_items SET kind='expense'; UPDATE invoice_lines SET kind='expense';",
      );
      expect(db.prepare("SELECT kind FROM billable_items").get().kind).toBe(
        "expense",
      );
      db.close();
      const restored = join(dir, "restored.sqlite");
      restoreSnapshot(backup, restored);
      db = new DatabaseSync(restored);
      expect(databaseSnapshot(db)).toEqual(before);
      migrateDatabase(db, restored);
      expect(databaseSnapshot(db)).toEqual(after);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
test("S28-T04：表再構築中の失敗で全列・制約・版・データを戻し退避を保持", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-expense-fail-")),
    path = join(dir, "db.sqlite"),
    db = legacy(path, 6);
  try {
    const before = databaseSnapshot(db),
      schema = db
        .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name")
        .all();
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "exec")
          return (sql) => {
            if (sql.includes("billable_items_s28")) {
              target.exec(sql);
              throw Error("failure");
            }
            return target.exec(sql);
          };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(() => migrateDatabase(proxy, path)).toThrow();
    expect(databaseSnapshot(db)).toEqual(before);
    expect(
      db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name").all(),
    ).toEqual(schema);
    const backup = join(
      dir,
      readdirSync(dir).find((name) => name.includes("pre-s28")),
    );
    const copy = new DatabaseSync(backup);
    expect(databaseSnapshot(copy)).toEqual(before);
    copy.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S28-T05：集計表の交通費の次に立替経費を表示", () => {
  const markup = renderToStaticMarkup(
    React.createElement(MonthlySummary, {
      data: monthSummary([company([row("e", "expense", 770)])]),
      year: 2026,
      month: 8,
    }),
  );
  expect(markup).toMatch(/交通費<\/th><th[^>]*>立替経費<\/th>/);
  expect(markup).toContain("¥770");
});
