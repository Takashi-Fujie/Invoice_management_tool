import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companyTotals, normalizeRow, changeReward } from "../src/reward.mjs";
import { acceptAmount, prepareMonth } from "../src/month.mjs";
import { amountText } from "../src/amount.mjs";
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
const row = (id, type, amount) => ({
  id,
  description:
    type === "adjustment" ? "値引き金額端数調整" : "原稿制作（架空）",
  rewardType: type,
  amount,
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "exclusive",
  feePriceMode: "exclusive",
  travelPriceMode: "inclusive",
  discountEnabled: true,
  discountRate: "2",
  withholdingEnabled: true,
});
const company = (id, rows) => ({
  id,
  name: "架空調整室" + id,
  revision: 0,
  rows,
  withholdingAmount: 100,
  invoiced: false,
  paid: false,
});
const data = () => ({
  companies: [
    company("a", [row("fee", "per_item", 10000), row("adj", "adjustment", -1)]),
    company("b", [row("other", "per_item", 0)]),
  ],
});
const put = (app, payload) =>
  app.inject({ method: "PUT", url: "/api/month/2026/4", headers, payload });
const get = async (app, month = 4) =>
  (await app.inject({ url: `/api/month/2026/${month}`, headers })).json();
test("S14-T01：調整だけ小計・請求額へ加減し元の内訳と源泉額を変えない", () => {
  const d = data(),
    base = companyTotals(d.companies[0].rows.slice(0, 1));
  for (const amount of [-1, 0, 1]) {
    const totals = companyTotals([
      d.companies[0].rows[0],
      row("a", "adjustment", amount),
    ]);
    expect(totals).toMatchObject({
      invoice: 10780 + amount,
      adjustment: amount,
      fee: 10000,
      tax: 1000,
      net: 10000,
      discount: 220,
    });
    for (const key of ["fee", "travel", "expense", "net", "tax", "discount"])
      expect(totals[key]).toBe(base[key]);
  }
  expect(monthSummary(d.companies).rows[0]).toMatchObject({
    gross: 10779,
    invoice: 10679,
    adjustment: -1,
    withheld: 100,
  });
  expect(monthSummary(d.companies).total.adjustment).toBe(-1);
});
test("S14-T02：調整だけ符号付き入力、途中の記号・小数・上限・タイプ往復", () => {
  expect(acceptAmount("", "-", true)).toBe("-");
  expect(acceptAmount("-", "-1", true)).toBe("-1");
  for (const v of ["--1", "1-", "1.5", "-1000000000", "+1"])
    expect(acceptAmount("0", v, true)).toBe("0");
  expect(acceptAmount("0", "-1")).toBe("0");
  expect(amountText("-1234", false)).toBe("-1,234");
  expect(normalizeRow(row("a", "adjustment", -999999999)).amount).toBe(
    -999999999,
  );
  for (const type of ["per_item", "travel", "expense", "hourly"])
    expect(() => normalizeRow(row("a", type, -1))).toThrow();
  const source = row("a", "per_item", 900),
    r = changeReward(source, { rewardType: "adjustment" });
  const negative = changeReward(r, { amount: -1 });
  expect(normalizeRow(negative).amount).toBe(-1);
  expect(() =>
    normalizeRow(changeReward(negative, { rewardType: "per_item" })),
  ).toThrow();
  const hourly = changeReward(negative, {
    rewardType: "hourly",
    hours: "1",
    rate: "100",
  });
  expect(normalizeRow(hourly)).toMatchObject({ amount: 100, manualAmount: -1 });
  expect(
    normalizeRow(changeReward(hourly, { rewardType: "adjustment" })).amount,
  ).toBe(-1);
  expect(source.amount).toBe(900);
  for (const amount of [null, -1.5, -1000000000])
    expect(() =>
      prepareMonth({
        companies: [company("a", [row("a", "adjustment", amount)])],
      }),
    ).toThrow();
  expect(() =>
    prepareMonth({ companies: [company("a", [row("a", "adjustment", -1)])] }),
  ).toThrow();
});
test("S14-T03：負の調整を保存・再起動・別月、ロック・全社拒否・競合・復元", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-adjust-")),
    path = join(dir, "db.sqlite");
  let app = createApp({ path });
  try {
    let response = await put(app, data());
    expect(response.statusCode).toBe(200);
    let saved = response.json();
    await app.close();
    app = createApp({ path });
    expect(await get(app)).toEqual(saved);
    expect(
      (await get(app, 5)).companies.every((c) => c.rows.length === 0),
    ).toBe(true);
    for (const patch of [
      { amount: -1.5 },
      { amount: -1000000000 },
      { amount: null },
      { description: "" },
      { rewardType: "per_item" },
    ]) {
      const bad = structuredClone(saved);
      Object.assign(bad.companies[0].rows[1], patch);
      bad.companies[1].rows[0].amount = 100;
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    const bad = structuredClone(saved);
    bad.companies[0].rows[1].amount = -999999999;
    expect((await put(app, bad)).statusCode).toBe(400);
    expect(await get(app)).toEqual(saved);
    const stale = structuredClone(saved);
    saved.companies[0].invoiced = true;
    saved = (await put(app, saved)).json();
    expect((await put(app, stale)).statusCode).toBe(409);
    const locked = structuredClone(saved);
    locked.companies[0].rows[1].amount = 0;
    expect((await put(app, locked)).statusCode).toBe(400);
    const db = new DatabaseSync(path),
      snapshot = databaseSnapshot(db),
      backup = join(dir, "saved.sqlite");
    expect(
      db
        .prepare(
          "SELECT kind,total_yen FROM invoice_lines WHERE billable_item_id='adj'",
        )
        .get(),
    ).toMatchObject({ kind: "adjustment", total_yen: -1 });
    expect(() =>
      db.exec("UPDATE billable_items SET amount_yen=-1 WHERE id='fee'"),
    ).toThrow();
    db.prepare("VACUUM INTO ?").run(backup);
    db.close();
    restoreSnapshot(backup, join(dir, "restored.sqlite"));
    const copy = new DatabaseSync(join(dir, "restored.sqlite"));
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
  "007-mvp2-expense.sql",
];
function legacy(path, version) {
  const db = new DatabaseSync(path);
  for (const file of files.slice(0, version))
    db.exec(
      readFileSync(new URL("../server/" + file, import.meta.url), "utf8"),
    );
  db.exec(
    "PRAGMA foreign_keys=ON; INSERT INTO clients VALUES('a','架空調整室',3); INSERT INTO invoices(id,client_id,target_year,target_month,total_yen,invoiced,paid) VALUES('i','a',2026,4,900,1,1); INSERT INTO billable_items(id,client_id,target_year,target_month,description,amount_yen) VALUES('b','a',2026,4,'原稿（架空）',900); INSERT INTO invoice_lines(id,invoice_id,billable_item_id,line_no,description,total_yen) VALUES('l','i','b',0,'原稿（架空）',900);",
  );
  return db;
}
for (const version of [1, 2, 3, 4, 5, 6, 7])
  test(`S14-T04：版${version}から版9の全旧列保持と退避復元・再移行`, () => {
    const dir = mkdtempSync(join(tmpdir(), "invoice-adjust-migrate-")),
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
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(migrateDatabase(db, path)).toBeNull();
      db.exec(
        "UPDATE billable_items SET kind='adjustment',amount_yen=-1; UPDATE invoice_lines SET kind='adjustment',total_yen=-1;",
      );
      db.close();
      restoreSnapshot(backup, join(dir, "restored.sqlite"));
      db = new DatabaseSync(join(dir, "restored.sqlite"));
      expect(databaseSnapshot(db)).toEqual(before);
      migrateDatabase(db, join(dir, "restored.sqlite"));
      expect(databaseSnapshot(db)).toEqual(after);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
test("S14-T04：版8の表再構築後の失敗で全構造・版・データと退避を保持", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-adjust-fail-")),
    path = join(dir, "db.sqlite"),
    db = legacy(path, 7);
  try {
    const before = databaseSnapshot(db),
      schema = db
        .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name")
        .all();
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "exec")
          return (sql) => {
            target.exec(sql);
            if (sql.includes("billable_items_s14")) throw Error("failure");
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
        readdirSync(dir).find((n) => n.includes("pre-s14")),
      ),
      copy = new DatabaseSync(backup);
    expect(databaseSnapshot(copy)).toEqual(before);
    copy.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S14-T05：集計で値引きの次に調整額を符号付き表示", () => {
  const html = renderToStaticMarkup(
    React.createElement(MonthlySummary, {
      data: monthSummary(data().companies),
      year: 2026,
      month: 4,
    }),
  );
  expect(html).toMatch(/値引き<\/th><th[^>]*>調整額<\/th>/);
  expect(html).toContain("-¥1");
});
