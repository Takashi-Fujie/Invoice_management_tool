import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.mjs";
import {
  companyTotals,
  normalizeRow,
  changeReward,
  defaultDiscountRate,
  acceptDiscountRate,
} from "../src/reward.mjs";
import {
  databaseSnapshot,
  migrateDatabase,
  restoreSnapshot,
} from "../server/migrations.mjs";
import { Session } from "../src/session.mjs";
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const row = (
  id,
  amount = 1000,
  priceMode = "exclusive",
  discountRate = "2",
) => ({
  id,
  description: "編集（架空）",
  amount,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode,
  feePriceMode: priceMode,
  travelPriceMode: "inclusive",
  withholdingEnabled: false,
  discountEnabled: true,
  discountRate,
});
const company = (id, rows) => ({
  id,
  name: "制作室（架空）",
  revision: 0,
  rows,
  invoiced: false,
  paid: false,
});
const get = async (app, m = 10) =>
  (await app.inject({ url: `/api/month/2026/${m}`, headers })).json();
const put = (app, payload, m = 10) =>
  app.inject({ method: "PUT", url: `/api/month/2026/${m}`, headers, payload });
test("S12-T01/T02：税込換算後の同率合算、初期率、十進数率、時給・交通費の分離", () => {
  expect(defaultDiscountRate(2026, 9)).toBe("1.3");
  expect(defaultDiscountRate(2026, 10)).toBe("2");
  expect(defaultDiscountRate(2027, 1)).toBe("2");
  expect(companyTotals([row("a"), row("b", 1100, "inclusive")])).toMatchObject({
    invoice: 2156,
    discount: 44,
    net: 2000,
    tax: 200,
  });
  expect(
    companyTotals([row("a", 75), row("b", 75, "exclusive", "2.0")]),
  ).toMatchObject({ invoice: 162, discount: 3 });
  expect(
    companyTotals([row("a", 75), row("b", 75, "exclusive", "1.3")]),
  ).toMatchObject({ invoice: 163, discount: 2 });
  expect(companyTotals([row("a", 109, "inclusive")])).toMatchObject({
    invoice: 107,
    discount: 2,
  });
  const travel = changeReward(row("t", 1100, "inclusive"), {
    rewardType: "travel",
  });
  expect(companyTotals([row("a", 10000), travel])).toMatchObject({
    invoice: 11880,
    discount: 220,
    travel: 1100,
  });
  const h = changeReward(row("h"), {
    rewardType: "hourly",
    hours: "1.5",
    rate: "3001",
  });
  expect(companyTotals([h])).toMatchObject({ invoice: 4853, discount: 99 });
  expect(
    companyTotals([
      row("a", 5, "exclusive", "10"),
      row("b", 5, "exclusive", "10"),
    ]),
  ).toMatchObject({ invoice: 10, discount: 1, tax: 1 });
  for (const bad of ["-1", "100.1", "１.３", "1e2", "abc"])
    expect(acceptDiscountRate("1.3", bad)).toBe("1.3");
  for (const patch of [
    { discountEnabled: 1 },
    { discountEnabled: "true" },
    { discountRate: "" },
    { discountRate: "101" },
    { discountRate: null },
  ])
    expect(() => normalizeRow({ ...row("bad"), ...patch })).toThrow();
  expect(companyTotals([row("all", 290, "exclusive", "100")])).toMatchObject({
    invoice: 0,
    discount: 319,
  });
});
test("S12-T01/T02：条件と請求額を保存して再起動・別月・交通費往復・退避復元で保持", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-discount-")),
    path = join(dir, "db.sqlite");
  let app = createApp({ path });
  try {
    let response = await put(app, {
      companies: [
        company("a", [row("a"), row("b", 1100, "inclusive")]),
        company("b", [row("c", 75)]),
      ],
    });
    expect(response.statusCode).toBe(200);
    const saved = response.json();
    expect(saved.companies[0].rows).toEqual([
      row("a"),
      row("b", 1100, "inclusive"),
    ]);
    await app.close();
    app = createApp({ path });
    expect(await get(app)).toEqual(saved);
    const other = await get(app, 9);
    other.companies[0].visible = true;
    other.companies[0].rows = [{ ...row("sep"), discountRate: "1.3" }];
    expect((await put(app, other, 9)).statusCode).toBe(200);
    expect((await get(app)).companies.map((c) => c.rows)).toEqual(
      saved.companies.map((c) => c.rows),
    );
    const back = changeReward(
      changeReward(saved.companies[0].rows[0], { rewardType: "travel" }),
      { rewardType: "per_item" },
    );
    expect(back.discountEnabled).toBe(true);
    expect(back.discountRate).toBe("2");
    const db = new DatabaseSync(path);
    expect(
      db
        .prepare(
          "SELECT total_yen FROM invoices WHERE client_id='a' AND target_month=10",
        )
        .get().total_yen,
    ).toBe(2156);
    expect(
      db
        .prepare(
          "SELECT discount_enabled,discount_rate FROM invoice_lines WHERE billable_item_id='b'",
        )
        .get(),
    ).toMatchObject({ discount_enabled: 1, discount_rate: "2" });
    const snapshot = databaseSnapshot(db),
      backup = join(dir, "saved.sqlite"),
      restored = join(dir, "restored.sqlite");
    db.prepare("VACUUM INTO ?").run(backup);
    db.close();
    restoreSnapshot(backup, restored);
    const copy = new DatabaseSync(restored);
    expect(databaseSnapshot(copy)).toEqual(snapshot);
    copy.close();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S12-T03：不正条件・請求済の金額不変な条件変更を拒否し全社を保全する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    let saved = (
      await put(app, {
        companies: [
          company("a", [row("a", 0)]),
          company("b", [row("b", 1100, "inclusive")]),
        ],
      })
    ).json();
    for (const patch of [
      { discountEnabled: 1 },
      { discountEnabled: null },
      { discountRate: "" },
      { discountRate: "100.01" },
      { discountRate: "1e2" },
    ]) {
      const bad = structuredClone(saved);
      bad.companies[0].rows[0].amount = 9000;
      Object.assign(bad.companies[1].rows[0], patch);
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    saved.companies[0].invoiced = true;
    saved = (await put(app, saved)).json();
    const bad = structuredClone(saved);
    bad.companies[0].rows[0].discountRate = "1.3";
    expect((await put(app, bad)).statusCode).toBe(400);
    expect(await get(app)).toEqual(saved);
    bad.companies[0].invoiced = false;
    expect((await put(app, bad)).statusCode).toBe(200);
    expect((await put(app, saved)).statusCode).toBe(409);
  } finally {
    await app.close();
  }
});
test("S12-T03：失敗後の値引き条件を保持して再保存できる", async () => {
  let fail = true;
  const initial = { companies: [company("a", [row("a")])] };
  const session = new Session(
    {
      load: async () => structuredClone(initial),
      save: async (d) => {
        if (fail) throw Error("通信失敗");
        return structuredClone(d);
      },
    },
    new Date(2026, 9, 1),
  );
  await session.open();
  const draft = structuredClone(session.draft);
  draft.companies[0].rows[0].discountRate = "1.3";
  session.edit(draft);
  await expect(session.save()).rejects.toThrow();
  expect(session.draft).toEqual(draft);
  fail = false;
  await session.save();
  expect(session.draft).toEqual(draft);
  expect(session.dirty).toBe(false);
});
function legacy(path) {
  const db = new DatabaseSync(path);
  for (const file of [
    "001-mvp1.sql",
    "002-mvp2-reward.sql",
    "003-mvp2-travel.sql",
    "004-mvp2-tax.sql",
  ])
    db.exec(
      readFileSync(new URL("../server/" + file, import.meta.url), "utf8"),
    );
  db.exec(
    "INSERT INTO clients VALUES('a','移行（架空）',2); INSERT INTO invoices VALUES('i','a',2026,9,1100,1,1); INSERT INTO billable_items(id,client_id,target_year,target_month,description,amount_yen) VALUES('b','a',2026,9,'既存（架空）',1100); INSERT INTO invoice_lines(id,invoice_id,billable_item_id,line_no,description,total_yen) VALUES('l','i','b',0,'既存（架空）',1100);",
  );
  return db;
}
test("S12-T04：版4→9の全旧列・請求額保持、退避復元・再移行・版9の重複適用防止", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-discount-migrate-")),
    path = join(dir, "db.sqlite");
  let db = legacy(path);
  try {
    const before = databaseSnapshot(db),
      backup = migrateDatabase(db, path),
      after = databaseSnapshot(db);
    expect(after.version).toBe(9);
    expect(backup).toContain("pre-s12");
    for (const [table, rows] of Object.entries(before.tables)) {
      const cols = Object.keys(rows[0] || {});
      expect(
        after.tables[table].map((r) =>
          Object.fromEntries(cols.map((k) => [k, r[k]])),
        ),
      ).toEqual(rows);
    }
    for (const table of ["billable_items", "invoice_lines"])
      expect(after.tables[table][0]).toMatchObject({
        discount_enabled: 0,
        discount_rate: "1.3",
      });
    expect(migrateDatabase(db, path)).toBeNull();
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
test("S12-T04：移行途中の失敗は追加列・版・データを戻し退避も保持", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-discount-fail-")),
    path = join(dir, "db.sqlite"),
    db = legacy(path);
  try {
    const before = databaseSnapshot(db);
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "exec")
          return (sql) => {
            if (sql.includes("ADD COLUMN discount_enabled")) {
              target.exec(
                "ALTER TABLE billable_items ADD COLUMN discount_enabled INTEGER",
              );
              throw Error("simulated failure");
            }
            return target.exec(sql);
          };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(() => migrateDatabase(proxy, path)).toThrow();
    expect(databaseSnapshot(db)).toEqual(before);
    const backup = join(
      dir,
      readdirSync(dir).find(
        (n) => n.includes("pre-s12") && n.endsWith(".sqlite"),
      ),
    );
    const copy = new DatabaseSync(backup, { readOnly: true });
    expect(databaseSnapshot(copy)).toEqual(before);
    copy.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
