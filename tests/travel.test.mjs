import { test, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.mjs";
import { changeReward, companyTotals } from "../src/reward.mjs";
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
const row = (id, rewardType, amount) => ({
  id,
  description: "交通費・原稿（架空）",
  rewardType,
  amount,
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "inclusive",
  feePriceMode: rewardType === "travel" ? "exclusive" : "inclusive",
  travelPriceMode: "inclusive",
  withholdingEnabled: false,
  discountEnabled: false,
  discountRate: "2",
});
const data = () => ({
  companies: [
    {
      id: "a",
      name: "架空制作室",
      revision: 0,
      rows: [row("fee", "per_item", 6000), row("travel", "travel", 700)],
      invoiced: false,
      paid: false,
    },
  ],
});
const put = (app, p) =>
  app.inject({ method: "PUT", url: "/api/month/2026/10", headers, payload: p });
const get = async (app) =>
  (await app.inject({ url: "/api/month/2026/10", headers })).json();
test("S10-T01：報酬・交通費を区別し請求額へ合算、切替で手入力額・時間・単価を保持", () => {
  expect(companyTotals(data().companies[0].rows)).toEqual({
    invoice: 6700,
    fee: 6000,
    travel: 700,
    expense: 0,
    adjustment: 0,
    net: 6091,
    tax: 609,
  });
  expect(
    changeReward(row("direct", "per_item", 1250), { rewardType: "travel" })
      .amount,
  ).toBe(1250);
  expect(
    changeReward(row("direct", "travel", 700), { rewardType: "per_item" })
      .amount,
  ).toBe(700);
  let r = changeReward(row("a", "travel", 700), { rewardType: "hourly" });
  r = changeReward(r, { hours: "1.5", rate: "3001" });
  expect(r.amount).toBe(4502);
  r = changeReward(r, { rewardType: "travel" });
  expect(r.amount).toBe(700);
  r = changeReward(r, { rewardType: "per_item" });
  expect(r.amount).toBe(700);
  r = changeReward(r, { rewardType: "hourly" });
  expect(r).toMatchObject({ hours: "1.5", rate: "3001", amount: 4502 });
});
test("S10-T02/T03：交通費の保存・再起動、請求済みの変更拒否、解除と不正値の全体ロールバック", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-travel-")),
    path = join(dir, "test.sqlite");
  let app = createApp({ path });
  try {
    let result = await put(app, data());
    expect(result.statusCode).toBe(200);
    let saved = result.json();
    await app.close();
    app = createApp({ path });
    expect(await get(app)).toEqual(saved);
    for (const amount of [-1, 1.5, 1000000000, null]) {
      const bad = structuredClone(saved);
      bad.companies[0].rows[0].amount = 1;
      bad.companies[0].rows[1].amount = amount;
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    const nextMonth = (
      await app.inject({ url: "/api/month/2026/11", headers })
    ).json();
    expect(nextMonth.companies[0].rows).toEqual([]);
    nextMonth.companies[0].visible = true;
    nextMonth.companies[0].rows = [row("nov-travel", "travel", 250)];
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/11",
          headers,
          payload: nextMonth,
        })
      ).statusCode,
    ).toBe(200);
    saved = await get(app);
    expect(saved.companies[0].rows).toEqual(data().companies[0].rows);
    saved.companies[0].invoiced = true;
    saved = (await put(app, saved)).json();
    const bad = structuredClone(saved);
    bad.companies[0].rows[1].amount = 0;
    expect((await put(app, bad)).statusCode).toBe(400);
    bad.companies[0].invoiced = false;
    result = await put(app, bad);
    expect(result.statusCode).toBe(200);
    expect(result.json().companies[0].rows[1].amount).toBe(0);
    const db = new DatabaseSync(path, { readOnly: true });
    expect(
      db.prepare("SELECT total_yen FROM invoices WHERE target_month=10").get()
        .total_yen,
    ).toBe(6000);
    expect(
      db
        .prepare(
          "SELECT kind FROM invoice_lines WHERE billable_item_id='travel'",
        )
        .get().kind,
    ).toBe("travel");
    db.close();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S10-T04：v2から移行して既存の全項目を保持し、退避から復元・再移行できる", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-travel-migrate-")),
    path = join(dir, "v2.sqlite");
  let db = new DatabaseSync(path);
  try {
    db.exec(
      readFileSync(new URL("../server/001-mvp1.sql", import.meta.url), "utf8"),
    );
    db.exec(
      readFileSync(
        new URL("../server/002-mvp2-reward.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      "INSERT INTO clients VALUES('a','架空会社',1); INSERT INTO invoices VALUES('i','a',2026,10,4502,1,1); INSERT INTO billable_items VALUES('b','a',2026,10,'架空業務',4502,'hourly','1.5','3001',700); INSERT INTO invoice_lines VALUES('l','i','b',0,'架空業務',4502,'hourly','1.5','3001');",
    );
    const before = databaseSnapshot(db),
      backup = migrateDatabase(db, path);
    expect(backup).toBeTruthy();
    const after = databaseSnapshot(db);
    expect(after.version).toBe(9);
    for (const table of Object.keys(before.tables)) {
      expect(
        after.tables[table].map(
          ({
            kind,
            price_mode,
            fee_price_mode,
            travel_price_mode,
            discount_enabled,
            discount_rate,
            withholding_enabled,
            withholding_yen,
            ...r
          }) => r,
        ),
      ).toEqual(before.tables[table]);
    }
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

test("S10-T04：交通費移行失敗時は列追加と版を戻し、退避を保持する", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-s10-fail-")),
    path = join(dir, "db.sqlite"),
    db = new DatabaseSync(path);
  try {
    for (const file of ["001-mvp1.sql", "002-mvp2-reward.sql"])
      db.exec(
        readFileSync(new URL("../server/" + file, import.meta.url), "utf8"),
      );
    const before = databaseSnapshot(db);
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "exec")
          return (sql) => {
            if (sql.includes("ADD COLUMN kind")) {
              target.exec("ALTER TABLE billable_items ADD COLUMN kind TEXT");
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
    expect(
      db
        .prepare("PRAGMA table_info(billable_items)")
        .all()
        .some((c) => c.name === "kind"),
    ).toBe(false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
