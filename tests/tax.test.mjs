import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.mjs";
import { changeReward, companyTotals, normalizeRow } from "../src/reward.mjs";
import { prepareMonth } from "../src/month.mjs";
import { Session } from "../src/session.mjs";
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
const row = (id, amount, priceMode = "exclusive") => ({
  id,
  description: "原稿（架空）",
  amount,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode,
  feePriceMode: priceMode,
  travelPriceMode: "inclusive",
  withholdingEnabled: false,
  discountEnabled: false,
  discountRate: "2",
});
const company = (id, rows) => ({
  id,
  name: "制作室（架空）",
  revision: 0,
  rows,
  invoiced: false,
  paid: false,
});
const get = async (app, m = 11) =>
  (await app.inject({ url: `/api/month/2026/${m}`, headers })).json();
const put = (app, p, m = 11) =>
  app.inject({
    method: "PUT",
    url: `/api/month/2026/${m}`,
    headers,
    payload: p,
  });
test("S11-T02：税込・税抜の合算後に切り捨て、時給計算後の金額も集計", () => {
  expect(companyTotals([row("e", 1000), row("i", 1100, "inclusive")])).toEqual({
    invoice: 2200,
    fee: 2100,
    travel: 0,
    expense: 0,
    adjustment: 0,
    net: 2000,
    tax: 200,
  });
  expect(companyTotals([row("a", 5), row("b", 5)])).toMatchObject({
    invoice: 11,
    net: 10,
    tax: 1,
  });
  expect(
    companyTotals([row("a", 6, "inclusive"), row("b", 6, "inclusive")]),
  ).toMatchObject({ invoice: 12, net: 11, tax: 1 });
  expect(companyTotals([row("a", 290)])).toMatchObject({
    invoice: 319,
    tax: 29,
  });
  const hourly = changeReward(row("hour", 0), {
    rewardType: "hourly",
    hours: "1.5",
    rate: "3001",
  });
  expect(hourly.amount).toBe(4502);
  expect(companyTotals([hourly])).toMatchObject({
    invoice: 4952,
    net: 4502,
    tax: 450,
  });
  expect(
    companyTotals([row("zero", 0), { ...row("blank", 0), amount: null }]),
  ).toMatchObject({ invoice: 0, net: 0, tax: 0 });
  expect(companyTotals([row("max", 999999999)])).toMatchObject({
    invoice: 1099999998,
    tax: 99999999,
  });
});
test("S11-T01：新規報酬から交通費へ初めて切替えると税込、区分の往復値も保持", () => {
  let r = row("a", 1000);
  r = changeReward(r, { rewardType: "travel" });
  expect(r).toMatchObject({ amount: 1000, priceMode: "inclusive" });
  r = changeReward(r, { priceMode: "exclusive" });
  expect(r.travelPriceMode).toBe("exclusive");
  r = changeReward(r, { rewardType: "hourly", hours: "1", rate: "1000" });
  expect(r.priceMode).toBe("exclusive");
  r = changeReward(r, { priceMode: "inclusive" });
  r = changeReward(r, { rewardType: "travel" });
  expect(r.priceMode).toBe("exclusive");
  r = changeReward(r, { rewardType: "per_item" });
  expect(r).toMatchObject({ priceMode: "inclusive", amount: 1000 });
  expect(normalizeRow(r)).toEqual(r);
});
test("S11-T03：不正な税区分・保持値を保存準備で拒否し、元入力を変えない", () => {
  for (const patch of [
    { priceMode: "unknown" },
    { priceMode: null },
    { feePriceMode: 8 },
    { travelPriceMode: "" },
    { feePriceMode: "inclusive" },
  ]) {
    const data = { companies: [company("a", [{ ...row("a", 10), ...patch }])] };
    const before = structuredClone(data);
    expect(() => prepareMonth(data)).toThrow();
    expect(data).toEqual(before);
  }
});
test("S11-T01/T02：区分と往復条件を保存し、再起動・別月・請求明細の写しと請求額を保持", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-tax-")),
    path = join(dir, "db.sqlite");
  let app = createApp({ path });
  try {
    const travel = changeReward(row("travel", 1100), { rewardType: "travel" });
    let r = await put(app, {
      companies: [
        company("a", [row("e", 1000), travel]),
        company("b", [row("b", 5)]),
      ],
    });
    expect(r.statusCode).toBe(200);
    const saved = r.json();
    expect(saved.companies[0].rows).toEqual([row("e", 1000), travel]);
    await app.close();
    app = createApp({ path });
    expect(await get(app)).toEqual(saved);
    const other = await get(app, 12);
    expect(other.companies.every((c) => c.rows.length === 0)).toBe(true);
    other.companies[0].visible = true;
    other.companies[0].rows = [row("dec", 100)];
    expect((await put(app, other, 12)).statusCode).toBe(200);
    const loaded = await get(app);
    expect(loaded.companies[0].rows).toEqual(saved.companies[0].rows);
    expect(
      changeReward(loaded.companies[0].rows[1], { rewardType: "per_item" })
        .priceMode,
    ).toBe("exclusive");
    const db = new DatabaseSync(path, { readOnly: true });
    expect(
      db
        .prepare(
          "SELECT total_yen FROM invoices WHERE client_id='a' AND target_month=11",
        )
        .get().total_yen,
    ).toBe(2200);
    expect(
      db
        .prepare(
          "SELECT price_mode,total_yen FROM invoice_lines WHERE billable_item_id='travel'",
        )
        .get(),
    ).toMatchObject({ price_mode: "inclusive", total_yen: 1100 });
    const snapshot = databaseSnapshot(db),
      backup = join(dir, "saved.sqlite");
    db.close();
    const writer = new DatabaseSync(path);
    writer.prepare("VACUUM INTO ?").run(backup);
    writer.close();
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
test("S11-T03：不正区分は他社の変更も保存せず、請求済は金額不変の区分変更も拒否", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    let saved = (
      await put(app, {
        companies: [
          company("a", [row("a", 1000)]),
          company("b", [row("b", 0)]),
        ],
      })
    ).json();
    for (const patch of [
      { priceMode: "other" },
      { priceMode: null },
      { travelPriceMode: "bad" },
      { feePriceMode: "inclusive" },
    ]) {
      const bad = structuredClone(saved);
      bad.companies[0].rows[0].amount = 8000;
      Object.assign(bad.companies[1].rows[0], patch);
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    saved.companies[1].invoiced = true;
    saved = (await put(app, saved)).json();
    const bad = structuredClone(saved);
    bad.companies[1].rows[0] = changeReward(bad.companies[1].rows[0], {
      priceMode: "inclusive",
    });
    expect((await put(app, bad)).statusCode).toBe(400);
    expect(await get(app)).toEqual(saved);
    const memory = structuredClone(saved);
    memory.companies[1].rows[0].travelPriceMode = "exclusive";
    expect((await put(app, memory)).statusCode).toBe(400);
    bad.companies[1].invoiced = false;
    expect((await put(app, bad)).statusCode).toBe(200);
    expect((await put(app, saved)).statusCode).toBe(409);
  } finally {
    await app.close();
  }
});
test("S11-T03：税区分を含む保存失敗時の入力を保持し、同じ入力を再試行できる", async () => {
  let fail = true;
  const initial = { companies: [company("a", [row("a", 1000)])] };
  const session = new Session(
    {
      load: async () => structuredClone(initial),
      save: async (d) => {
        if (fail) throw Error("通信失敗");
        return structuredClone(d);
      },
    },
    new Date(2026, 10, 1),
  );
  await session.open();
  const draft = structuredClone(session.draft);
  draft.companies[0].rows[0] = changeReward(draft.companies[0].rows[0], {
    priceMode: "inclusive",
  });
  session.edit(draft);
  await expect(session.save()).rejects.toThrow();
  expect(session.draft).toEqual(draft);
  expect(session.dirty).toBe(true);
  fail = false;
  await session.save();
  expect(session.draft).toEqual(draft);
  expect(session.dirty).toBe(false);
});
function legacyDb(path, version) {
  const db = new DatabaseSync(path);
  for (const file of [
    "001-mvp1.sql",
    "002-mvp2-reward.sql",
    "003-mvp2-travel.sql",
  ].slice(0, version))
    db.exec(
      readFileSync(new URL("../server/" + file, import.meta.url), "utf8"),
    );
  db.exec(
    "INSERT INTO clients VALUES('a','移行確認（架空）',3); INSERT INTO invoices VALUES('i','a',2026,11,12345,1,1); INSERT INTO billable_items(id,client_id,target_year,target_month,description,amount_yen) VALUES('b','a',2026,11,'既存（架空）',12345); INSERT INTO invoice_lines(id,invoice_id,billable_item_id,line_no,description,total_yen) VALUES('l','i','b',0,'既存（架空）',12345);",
  );
  if (version === 3) {
    db.exec(
      "UPDATE billable_items SET kind='travel'; UPDATE invoice_lines SET kind='travel';",
    );
  }
  return db;
}
for (const version of [1, 2, 3])
  test(`S11-T04：版${version}→9の全旧列保持・退避一致・復元・再移行・再起動`, () => {
    const dir = mkdtempSync(join(tmpdir(), "invoice-tax-migrate-")),
      path = join(dir, "db.sqlite");
    let db = legacyDb(path, version);
    try {
      const before = databaseSnapshot(db),
        backup = migrateDatabase(db, path),
        after = databaseSnapshot(db);
      expect(after.version).toBe(9);
      expect(backup).toBeTruthy();
      for (const [table, rows] of Object.entries(before.tables)) {
        const oldColumns = Object.keys(rows[0] || {});
        expect(
          after.tables[table].map((r) =>
            Object.fromEntries(oldColumns.map((k) => [k, r[k]])),
          ),
        ).toEqual(rows);
      }
      for (const table of ["billable_items", "invoice_lines"])
        expect(after.tables[table][0].price_mode).toBe("inclusive");
      expect(after.tables.billable_items[0].fee_price_mode).toBe(
        version === 3 ? "exclusive" : "inclusive",
      );
      expect(migrateDatabase(db, path)).toBeNull();
      expect(databaseSnapshot(db)).toEqual(after);
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
test("S11-T04：税区分移行途中の失敗は列・版・データを戻し退避を保持", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-tax-fail-")),
    path = join(dir, "db.sqlite"),
    db = legacyDb(path, 3);
  try {
    const before = databaseSnapshot(db);
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "exec")
          return (sql) => {
            if (sql.includes("ADD COLUMN price_mode")) {
              target.exec(
                "ALTER TABLE billable_items ADD COLUMN price_mode TEXT",
              );
              throw Error("simulated failure");
            }
            return target.exec(sql);
          };
        const v = target[key];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    expect(() => migrateDatabase(proxy, path)).toThrow();
    expect(databaseSnapshot(db)).toEqual(before);
    const retainedBackup = join(
      dir,
      readdirSync(dir).find(
        (n) => n.includes("pre-s11") && n.endsWith(".sqlite"),
      ),
    );
    const backupDb = new DatabaseSync(retainedBackup, { readOnly: true });
    expect(databaseSnapshot(backupDb)).toEqual(before);
    backupDb.close();
    expect(
      db
        .prepare("PRAGMA table_info(billable_items)")
        .all()
        .some((c) => c.name === "price_mode"),
    ).toBe(false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
