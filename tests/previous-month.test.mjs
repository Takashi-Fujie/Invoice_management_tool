import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Session } from "../src/session.mjs";
import { prepareMonth } from "../src/month.mjs";
import { companyTotals } from "../src/reward.mjs";
import { copyBlockReason, copyPreviousMonth } from "../src/previous-month.mjs";
import { createApp } from "../server/app.mjs";
const blank = (patch = {}) => ({
  id: randomUUID(),
  description: "",
  amount: null,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "exclusive",
  feePriceMode: "exclusive",
  travelPriceMode: "inclusive",
  discountEnabled: false,
  discountRate: "2",
  withholdingEnabled: false,
  ...patch,
});
const fee = (patch = {}) =>
  blank({ description: "原稿制作（架空）", amount: 50000, ...patch });
const company = (id, rows = [], patch = {}) => ({
  id,
  name: "同名会社（架空）",
  revision: 3,
  rows,
  invoiced: false,
  paid: false,
  withholdingAmount: 0,
  ...patch,
});
const draft = () => ({
  companies: [company("a", [blank()]), company("b", [fee({ amount: 900 })])],
});
const previous = () => ({
  companies: [
    company(
      "a",
      [
        fee(),
        fee({
          rewardType: "hourly",
          hours: "1.5",
          rate: "3001",
          amount: 4502,
          manualAmount: 777,
          discountEnabled: true,
          discountRate: "1.3",
          withholdingEnabled: true,
        }),
        fee({ rewardType: "travel", amount: 1200, priceMode: "inclusive" }),
        fee({ rewardType: "expense", amount: 600, priceMode: "inclusive" }),
      ],
      { invoiced: true, paid: true, withholdingAmount: 5105 },
    ),
    company("b", [fee({ amount: 999 })]),
  ],
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
function session(data = previous(), today = new Date(2026, 11, 2)) {
  const calls = [];
  const s = new Session(
    {
      load: async (y, m) => {
        calls.push([y, m]);
        return structuredClone(data);
      },
    },
    today,
  );
  s.draft = draft();
  s.base = structuredClone(s.draft);
  return { s, calls };
}
test("S27-T01：同社の報酬と条件だけを新IDでコピーし、元明細・他社・コピー先の源泉額を保持する", async () => {
  const source = previous(),
    before = structuredClone(source),
    { s, calls } = session(source);
  s.draft.companies[0].withholdingAmount = 123;
  const other = structuredClone(s.draft.companies[1]);
  const result = await copyPreviousMonth(s, "a");
  expect(calls).toEqual([[2026, 11]]);
  expect(result).toMatchObject({ year: 2026, month: 11, count: 2 });
  const a = s.draft.companies[0];
  expect(a).toMatchObject({
    revision: 3,
    withholdingAmount: 123,
    invoiced: false,
    paid: false,
  });
  expect(a.rows).toHaveLength(2);
  a.rows.forEach((r, i) => {
    expect(r.id).not.toBe(source.companies[0].rows[i].id);
    expect({ ...r, id: "id" }).toEqual({
      ...source.companies[0].rows[i],
      id: "id",
    });
  });
  expect(new Set(a.rows.map((r) => r.id)).size).toBe(2);
  expect(s.draft.companies[1]).toEqual(other);
  expect(source).toEqual(before);
  expect(s.dirty).toBe(true);
  a.rows[0].description = "コピー先の訂正";
  expect(source).toEqual(before);
});
test("S27-T02/T03：1月は前年12月から読み取り、年月切替だけではコピーしない", async () => {
  const { s, calls } = session(previous(), new Date(2027, 0, 2));
  await copyPreviousMonth(s, "a");
  expect(calls).toEqual([[2026, 12]]);
  const empty = new Session(
    { load: async () => ({ companies: [company("a")] }) },
    new Date(2026, 11, 2),
  );
  await empty.open();
  await empty.switchTo(2027, 1);
  expect(empty.draft.companies[0].rows).toEqual([]);
  expect(empty.dirty).toBe(false);
});
test("S27-T04：0円・途中入力・条件変更・請求済と入金済を上書きせず、連続操作もしない", async () => {
  for (const patch of [
    { description: "途中" },
    { amount: 0 },
    { hours: "0" },
    { rate: "0" },
    { manualAmount: 0 },
    { rewardType: "hourly" },
    { rewardType: "travel" },
    { rewardType: "expense" },
    { priceMode: "inclusive" },
    { feePriceMode: "inclusive" },
    { travelPriceMode: "exclusive" },
    { discountEnabled: true },
    { discountRate: "1.3" },
    { withholdingEnabled: true },
  ]) {
    const { s, calls } = session();
    s.draft.companies[0].rows = [blank(patch)];
    const before = structuredClone(s.draft);
    expect(copyBlockReason(s.draft.companies[0], 2026, 12)).toMatch(/明細/);
    await expect(copyPreviousMonth(s, "a")).rejects.toThrow(/明細/);
    expect(s.draft).toEqual(before);
    expect(calls).toEqual([]);
  }
  for (const checks of [
    { invoiced: true },
    { invoiced: true, paid: true },
    { invoiced: false, paid: true },
  ]) {
    const { s, calls } = session();
    Object.assign(s.draft.companies[0], checks);
    await expect(copyPreviousMonth(s, "a")).rejects.toThrow(/請求済|入金済/);
    expect(calls).toEqual([]);
  }
  const { s, calls } = session();
  await copyPreviousMonth(s, "a");
  const before = structuredClone(s.draft);
  await expect(copyPreviousMonth(s, "a")).rejects.toThrow(/明細/);
  expect(s.draft).toEqual(before);
  expect(calls).toHaveLength(1);
});
test("S27-T04/T05：空の入力用行だけを置換し、会社・報酬がない場合は入力と保存基準を変えない", async () => {
  for (const data of [
    { companies: [] },
    { companies: [company("b", [fee()])] },
    { companies: [company("a")] },
    {
      companies: [
        company("a", [
          fee({ rewardType: "travel" }),
          fee({ rewardType: "expense" }),
        ]),
      ],
    },
  ]) {
    const { s } = session(data);
    const before = structuredClone(s.draft),
      base = structuredClone(s.base);
    expect(await copyPreviousMonth(s, "a")).toMatchObject({ count: 0 });
    expect(s.draft).toEqual(before);
    expect(s.base).toEqual(base);
    expect(s.dirty).toBe(false);
  }
  const { s } = session();
  s.draft.companies[0].rows = [blank(), blank()];
  await copyPreviousMonth(s, "a");
  expect(s.draft.companies[0].rows).toHaveLength(2);
});
test("S27-T04：9月の既定条件と空行を扱い、年の下限には前月を要求しない", async () => {
  const { s } = session(previous(), new Date(2026, 8, 2));
  s.draft.companies[0].rows = [blank({ discountRate: "1.3" })];
  await copyPreviousMonth(s, "a");
  expect(s.draft.companies[0].rows).toHaveLength(2);
  const t = session();
  t.s.year = 1;
  t.s.month = 1;
  t.s.draft.companies[0].rows = [blank({ discountRate: "1.3" })];
  expect(copyBlockReason(t.s.draft.companies[0], 1, 1)).toMatch(/前月/);
  await expect(copyPreviousMonth(t.s, "a")).rejects.toThrow(/前月/);
  expect(t.calls).toEqual([]);
});
test("S27-T06：読取失敗で全社の未保存入力・年月・基準を保持し再試行できる", async () => {
  const { s } = session();
  s.draft.companies[1].rows[0].description = "他社の未保存";
  const before = structuredClone(s.draft),
    base = structuredClone(s.base);
  s.api.load = async () => {
    throw Error("通信失敗");
  };
  await expect(copyPreviousMonth(s, "a")).rejects.toThrow("通信失敗");
  expect(s.busy).toBe(false);
  expect(s.draft).toEqual(before);
  expect(s.base).toEqual(base);
  expect([s.year, s.month]).toEqual([2026, 12]);
  s.api.load = async () => previous();
  await copyPreviousMonth(s, "a");
  expect(s.draft.companies[1]).toEqual(before.companies[1]);
});
test("S27-T06：読取中の編集・月切替・保存・連続コピーを止め、変更された対象へ適用しない", async () => {
  const { s } = session(),
    pending = deferred();
  s.api.load = () => pending.promise;
  const copying = copyPreviousMonth(s, "a");
  expect(s.busy).toBe(true);
  const before = structuredClone(s.draft);
  s.edit({ companies: [] });
  expect(s.draft).toEqual(before);
  expect(await s.switchTo(2027, 1)).toBe("busy");
  await s.save();
  await expect(copyPreviousMonth(s, "a")).rejects.toThrow(/処理中/);
  pending.resolve(previous());
  await copying;
  expect(s.draft.companies[0].rows).toHaveLength(2);
  expect(s.busy).toBe(false);
  const t = session(),
    hold = deferred();
  t.s.api.load = () => hold.promise;
  const stale = copyPreviousMonth(t.s, "a");
  t.s.month = 10;
  hold.resolve(previous());
  await expect(stale).rejects.toThrow(/対象/);
  expect(t.s.draft.companies[0].rows[0].description).toBe("");
  expect(t.s.busy).toBe(false);
});
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
function api(appRef) {
  return {
    load: async (y, m) => {
      const r = await appRef().inject({ url: `/api/month/${y}/${m}`, headers });
      if (r.statusCode !== 200) throw Error(r.json().message);
      return r.json();
    },
    save: async (d, y, m) => {
      const r = await appRef().inject({
        method: "PUT",
        url: `/api/month/${y}/${m}`,
        headers,
        payload: prepareMonth(d, y, m),
      });
      if (r.statusCode !== 200) throw Error(r.json().message);
      return r.json();
    },
  };
}
test("S27-T07：コピーはDBを変更せず、編集・保存・再起動後も新ID・金額・条件を保持する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-s27-")),
    path = join(dir, "test.sqlite");
  let app = createApp({ path });
  try {
    const service = api(() => app);
    await service.save(
      { companies: previous().companies.map((c) => ({ ...c, revision: 0 })) },
      2026,
      12,
    );
    const source = await service.load(2026, 12);
    const db = new DatabaseSync(path);
    const oldLines = db
      .prepare("SELECT * FROM invoice_lines ORDER BY id")
      .all();
    db.close();
    const s = new Session(service, new Date(2027, 0, 2));
    await s.open();
    s.draft.companies.forEach((c) => (c.visible = true));
    s.draft.companies[0].withholdingAmount = 456;
    s.draft.companies[1].rows = [fee({ amount: 700 })];
    const counts = app.store.counts();
    await copyPreviousMonth(s, "a");
    expect(app.store.counts()).toEqual(counts);
    expect(await service.load(2026, 12)).toEqual(source);
    const ids = s.draft.companies[0].rows.map((r) => r.id);
    s.draft.companies[0].rows[0].amount = 60000;
    await s.save();
    const expected = structuredClone(s.draft);
    expect(s.dirty).toBe(false);
    expect(companyTotals(expected.companies[0].rows).invoice).toBe(70888);
    await s.switchTo(2026, 12);
    expect(s.draft.companies[0].rows).toEqual(source.companies[0].rows);
    await s.switchTo(2027, 1);
    expect(s.draft).toEqual(expected);
    await app.close();
    app = createApp({ path });
    expect(await service.load(2027, 1)).toEqual(expected);
    expect((await service.load(2026, 12)).companies[0].rows).toEqual(
      source.companies[0].rows,
    );
    expect(expected.companies[0].rows.map((r) => r.id)).toEqual(ids);
    const check = new DatabaseSync(path);
    expect(check.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      check
        .prepare(
          "SELECT * FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE target_year=2026 AND target_month=12) ORDER BY id",
        )
        .all(),
    ).toEqual(oldLines);
    check.close();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S27-T06/T08：保存失敗・競合で入力を保持し、元IDの流用と請求済変更をAPIが拒否する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const service = api(() => app);
    await service.save(
      { companies: previous().companies.map((c) => ({ ...c, revision: 0 })) },
      2026,
      11,
    );
    const s = new Session(service, new Date(2026, 11, 2));
    await s.open();
    s.draft.companies[0].visible = true;
    await copyPreviousMonth(s, "a");
    const copied = structuredClone(s.draft);
    const realSave = s.api.save;
    s.api.save = async () => {
      throw Error("通信失敗");
    };
    await expect(s.save()).rejects.toThrow();
    expect(s.draft).toEqual(copied);
    expect(s.dirty).toBe(true);
    s.api.save = realSave;
    const concurrent = await service.load(2026, 12);
    concurrent.companies[1].visible = true;
    concurrent.companies[1].rows = [fee({ amount: 100 })];
    await service.save(concurrent, 2026, 12);
    await expect(s.save()).rejects.toThrow(/別の画面/);
    expect(s.draft).toEqual(copied);
    expect(s.dirty).toBe(true);
    const fresh = new Session(service, new Date(2026, 11, 2));
    await fresh.open();
    fresh.draft.companies[0].visible = true;
    await copyPreviousMonth(fresh, "a");
    const source = await service.load(2026, 11);
    const hijack = structuredClone(fresh.draft);
    hijack.companies[0].rows[0].id = source.companies[0].rows[0].id;
    await expect(service.save(hijack, 2026, 12)).rejects.toThrow(
      /別の会社・月/,
    );
    await fresh.save();
    fresh.draft.companies[0].invoiced = true;
    await fresh.save();
    fresh.draft.companies[0].rows[0].amount = 1;
    await expect(fresh.save()).rejects.toThrow(/請求済/);
  } finally {
    await app.close();
  }
});
