import { test, expect } from "vitest";
import { createApp } from "../server/app.mjs";
import {
  hourlyAmount,
  changeReward,
  acceptDecimal,
  normalizeRow,
} from "../src/reward.mjs";
import { prepareMonth } from "../src/month.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databaseSnapshot, restoreSnapshot } from "../server/migrations.mjs";
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const row = (id, amount = 1000) => ({
  id,
  description: "原稿（架空）",
  amount,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "inclusive",
  feePriceMode: "inclusive",
  travelPriceMode: "inclusive",
  withholdingEnabled: false,
  discountEnabled: false,
  discountRate: "2",
});
const company = (id, rows) => ({
  id,
  name: "制作会社（架空）",
  revision: 0,
  rows,
  invoiced: false,
  paid: false,
});
const hour = (id) => ({
  ...row(id),
  rewardType: "hourly",
  hours: "1.5",
  rate: "3001",
  amount: 4502,
});
const get = async (app, month = 10) =>
  (await app.inject({ url: `/api/month/2026/${month}`, headers })).json();
const put = (app, data, month = 10) =>
  app.inject({
    method: "PUT",
    url: `/api/month/2026/${month}`,
    headers,
    payload: data,
  });

test("S09-T02：十進数の時給計算を円未満切り上げ、空欄・0・不正値・上限を区別", () => {
  for (const [h, r, amount] of [
    ["1.5", "3001", 4502],
    ["1.1", "100", 110],
    ["0.1", "0.1", 1],
    ["0.0001", "0.0001", 1],
    ["0", "3000", 0],
    ["999999999", "1", 999999999],
  ])
    expect(hourlyAmount(h, r)).toBe(amount);
  for (const [h, r] of [
    ["", "3000"],
    ["1", ""],
    ["１", "100"],
    ["-1", "100"],
    ["1e2", "100"],
    ["1000000000", "1"],
    [1.5, "100"],
  ])
    expect(hourlyAmount(h, r)).toBeNull();
  for (const v of ["abc", "１.５", "-1", "1e3", "1,000"])
    expect(acceptDecimal("1.5", v)).toBe("1.5");
  expect(acceptDecimal("1.5", "0.25")).toBe("0.25");
  expect(acceptDecimal("0", "")).toBe("");
});
test("S08-T03：案件単価と時給を切り替えても以前の入力を復元し、他明細に影響しない", () => {
  const original = row("a", 12500);
  let next = changeReward(original, { rewardType: "hourly" });
  expect(original.amount).toBe(12500);
  expect(next.amount).toBeNull();
  next = changeReward(next, { hours: "2", rate: "1500" });
  expect(next.amount).toBe(3000);
  next = changeReward(next, { rewardType: "per_item" });
  expect(next.amount).toBe(12500);
  next = changeReward(next, { rewardType: "hourly" });
  expect(next).toMatchObject({ hours: "2", rate: "1500", amount: 3000 });
  expect(normalizeRow(next)).toEqual(next);
  const emptyManual = { ...row("empty"), amount: null };
  const computed = changeReward(emptyManual, {
    rewardType: "hourly",
    hours: "2",
    rate: "1500",
  });
  expect(changeReward(computed, { rewardType: "per_item" }).amount).toBeNull();
});
test("未完成の時給入力を空行として捨てず、空行と0円を正しく保存準備する", () => {
  const blank = { ...row("blank"), description: "", amount: null };
  const data = { companies: [company("a", [blank, row("zero", 0)])] };
  expect(prepareMonth(data).companies[0].rows).toEqual([row("zero", 0)]);
  for (const patch of [
    { hours: "1" },
    { rate: "3000" },
    { manualAmount: 2000 },
  ]) {
    const partial = { ...blank, rewardType: "hourly", ...patch };
    expect(() =>
      prepareMonth({ companies: [company("a", [partial])] }),
    ).toThrow();
  }
  expect(() =>
    prepareMonth({ companies: [company("a", [{ ...hour("h"), amount: 1 }])] }),
  ).toThrow();
});
test("S08-T02：複数社・複数月の種類・小数時間・単価・金額・以前の手入力額が再起動後も残る", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-reward-")),
    path = join(dir, "test.sqlite");
  let app = createApp({ path });
  try {
    const data = {
      companies: [
        company("a", [
          row("flat", 12500),
          { ...hour("hour"), manualAmount: 17000 },
        ]),
        company("b", [row("b", 8000)]),
      ],
    };
    const result = await put(app, data);
    expect(result.statusCode).toBe(200);
    expect(result.json().companies[0].rows).toEqual(data.companies[0].rows);
    const empty = await get(app, 11);
    expect(empty.companies.map((c) => c.rows)).toEqual([[], []]);
    empty.companies[1].visible = true;
    empty.companies[1].rows = [
      { ...hour("nov"), hours: "1.1", rate: "100", amount: 110 },
    ];
    expect((await put(app, empty, 11)).statusCode).toBe(200);
    await app.close();
    app = createApp({ path });
    expect((await get(app)).companies[0].rows).toEqual(data.companies[0].rows);
    expect((await get(app, 11)).companies[1].rows[0]).toMatchObject({
      rewardType: "hourly",
      hours: "1.1",
      rate: "100",
      amount: 110,
    });
    await app.close();
    const db = new DatabaseSync(path);
    const snapshot = databaseSnapshot(db);
    expect(snapshot.tables.invoice_lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          billable_item_id: "hour",
          reward_type: "hourly",
          hours_text: "1.5",
          rate_text: "3001",
          total_yen: 4502,
        }),
      ]),
    );
    const backup = join(dir, "saved.sqlite");
    db.prepare("VACUUM INTO ?").run(backup);
    db.close();
    const restoredPath = join(dir, "restored.sqlite");
    restoreSnapshot(backup, restoredPath);
    const restoredDb = new DatabaseSync(restoredPath);
    expect(databaseSnapshot(restoredDb)).toEqual(snapshot);
    restoredDb.close();
    app = createApp({ path: restoredPath });
    expect((await get(app)).companies[0].rows).toEqual(data.companies[0].rows);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S09-T01/T03：不正な計算額・種類・時間・単価を拒否し全社の保存を戻す", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const saved = (
      await put(app, {
        companies: [company("a", [row("a")]), company("b", [hour("b")])],
      })
    ).json();
    for (const patch of [
      { amount: 4501 },
      { rewardType: "unknown" },
      { hours: "１.５" },
      { hours: "" },
      { rate: "-1" },
      { rate: 3001 },
      { hours: "1000000000" },
      { manualAmount: -1000000000 },
    ]) {
      const bad = structuredClone(saved);
      bad.companies[0].rows[0].amount = 9999;
      Object.assign(bad.companies[1].rows[0], patch);
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
  } finally {
    await app.close();
  }
});
test("S08-T03：請求済の時間・単価を同じ金額の別条件へ変更しても拒否する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const saved = (
      await put(app, {
        companies: [{ ...company("a", [hour("a")]), invoiced: true }],
      })
    ).json();
    const bad = structuredClone(saved);
    Object.assign(bad.companies[0].rows[0], { hours: "1", rate: "4502" });
    expect((await put(app, bad)).statusCode).toBe(400);
    expect(await get(app)).toEqual(saved);
    bad.companies[0].invoiced = false;
    expect((await put(app, bad)).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
