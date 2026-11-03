import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { Session } from "../src/session.mjs";
import { changeChecks } from "../src/checks.mjs";
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const content = {
  company: "青空制作室（架空）",
  rows: [
    { id: "line-1", description: "原稿制作", amount: 10000 },
    { id: "line-2", description: "原稿制作", amount: 20000 },
  ],
  invoiced: true,
  paid: true,
  revision: 0,
};
const savedRows = content.rows.map((r) => ({
  ...r,
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
}));
// MVP1の同じ振る舞いを、S07の複数社APIで1社のケースとして検証する。
const monthData = (c) => ({
  companies: [
    {
      id: "client-one",
      name: c.company,
      revision: c.revision,
      rows: c.rows,
      invoiced: c.invoiced,
      paid: c.paid,
    },
  ],
});
test("チェックは請求→入金の順で付け、入金→請求の順で外せる", () => {
  let state = { invoiced: false, paid: false };
  state = changeChecks(state, "paid", true);
  expect(state).toEqual({ invoiced: false, paid: false });
  state = changeChecks(state, "invoiced", true);
  state = changeChecks(state, "paid", true);
  expect(changeChecks(state, "invoiced", false)).toEqual({
    invoiced: true,
    paid: true,
  });
  state = changeChecks(state, "paid", false);
  state = changeChecks(state, "invoiced", false);
  expect(state).toEqual({ invoiced: false, paid: false });
  expect(changeChecks({ invoiced: false, paid: true }, "paid", false)).toEqual({
    invoiced: false,
    paid: false,
  });
});
test("APIも不整合チェックを拒否し既存データを変えない", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/10",
          headers,
          payload: monthData({ ...content, invoiced: false }),
        })
      ).statusCode,
    ).toBe(400);
    expect(app.store.counts().invoices).toBe(0);
    await app.inject({
      method: "PUT",
      url: "/api/month/2026/10",
      headers,
      payload: monthData(content),
    });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/10",
          headers,
          payload: monthData({ ...content, revision: 1, invoiced: false }),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: "/api/month/2026/10", headers })).json(),
    ).toMatchObject({
      companies: [{ invoiced: true, paid: true, revision: 1 }],
    });
  } finally {
    await app.close();
  }
});
test("請求済のまま明細を書き換えず、チェックを戻したときだけ訂正できる", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    await app.inject({
      method: "PUT",
      url: "/api/month/2026/10",
      headers,
      payload: monthData({ ...content, invoiced: true }),
    });
    const changed = {
      ...content,
      revision: 1,
      invoiced: true,
      rows: [{ ...content.rows[0], amount: 50000 }],
    };
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/10",
          headers,
          payload: monthData(changed),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/10",
          headers,
          payload: monthData({ ...changed, invoiced: false, paid: false }),
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
test("SQLite：同名業務を別明細で保存、再起動後も金額・独立チェック・会社を保持", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-test-")),
    path = join(dir, "test.sqlite");
  let app = createApp({ path });
  try {
    expect(
      (await app.inject({ url: "/api/month/2026/10", headers })).json()
        .companies[0]?.rows ?? [],
    ).toEqual([]);
    const saved = await app.inject({
      method: "PUT",
      url: "/api/month/2026/10",
      headers,
      payload: monthData(content),
    });
    expect(saved.statusCode).toBe(200);
    await app.close();
    app = createApp({ path });
    const restored = (
      await app.inject({ url: "/api/month/2026/10", headers })
    ).json().companies[0];
    expect(restored.rows).toEqual(savedRows);
    expect(restored.paid).toBe(true);
    expect(restored.invoiced).toBe(true);
    const empty = (
      await app.inject({ url: "/api/month/2027/1", headers })
    ).json().companies[0];
    expect(empty.rows).toEqual([]);
    expect(empty.name).toBe(content.company);
    expect(app.store.counts()).toEqual({
      clients: 1,
      billable_items: 2,
      invoices: 1,
      invoice_lines: 2,
      client_month_visibility: 1,
    });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/10",
          headers,
          payload: monthData(content),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ url: "/api/month/2026/10", headers })).json()
        .companies[0]?.rows ?? [],
    ).toEqual(savedRows);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("不正データ・二重ID・別月IDの流用・不正Origin/Hostを拒否し既存明細を維持", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/10",
          headers,
          payload: monthData(content),
        })
      ).statusCode,
    ).toBe(200);
    for (const rows of [
      [{ id: "x", description: "", amount: 1 }],
      [{ id: "x", description: "原稿", amount: 1.5 }],
      [{ id: "x", description: "原稿", amount: -1 }],
      [content.rows[0], content.rows[0]],
    ]) {
      expect(
        (
          await app.inject({
            method: "PUT",
            url: "/api/month/2026/10",
            headers,
            payload: monthData({ ...content, revision: 1, rows }),
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/11",
          headers,
          payload: monthData({ ...content, revision: 1 }),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: "/api/month/2026/13", headers })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: "/api/month/2026/10",
          headers: { host: "evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/10",
          headers: { ...headers, origin: "https://evil.example" },
          payload: monthData(content),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: "/api/month/2026/10", headers })).json()
        .companies[0]?.rows ?? [],
    ).toEqual(savedRows);
  } finally {
    await app.close();
  }
});
function session(
  load = async () => structuredClone(content),
  save = async (x) => ({ ...x, revision: x.revision + 1 }),
) {
  return new Session({ load, save }, new Date(2026, 9, 31));
}
test("当月初期表示、空月、年またぎ、同じ月の選択で未保存内容を保持", async () => {
  let writes = 0;
  const s = session(
    async () => ({ ...content, rows: [] }),
    async (x) => {
      writes++;
      return x;
    },
  );
  await s.open();
  expect(s.month).toBe(10);
  expect(s.year).toBe(2026);
  s.edit({ ...s.draft, company: "編集済" });
  expect(await s.switchTo(2026, 10)).toBe("same");
  expect(s.draft.company).toBe("編集済");
  expect(await s.switchTo(2026, 12)).toBe("confirm");
  await s.switchTo(2026, 12, "discard");
  expect(s.adjacent(1)).toEqual({ year: 2027, month: 1 });
  expect(writes).toBe(0);
});
test("保存失敗時は元の月と入力を保持、保存成功後の読取失敗は保存済みで元月に留まる", async () => {
  let saveError = true,
    readError = false;
  const s = session(
    async () => {
      if (readError) throw Error("読取失敗");
      return structuredClone(content);
    },
    async (x) => {
      if (saveError) throw Error("保存失敗");
      return { ...x, revision: 1 };
    },
  );
  await s.open();
  s.edit({ ...s.draft, company: "変更" });
  await expect(s.switchTo(2026, 11, "save")).rejects.toThrow("保存失敗");
  expect(s.month).toBe(10);
  expect(s.draft.company).toBe("変更");
  expect(s.dirty).toBe(true);
  saveError = false;
  readError = true;
  await expect(s.switchTo(2026, 11, "save")).rejects.toThrow("読取失敗");
  expect(s.month).toBe(10);
  expect(s.dirty).toBe(false);
});
test("破棄を選んでも読取失敗なら編集中の入力を保持、処理中の重複操作を抑止", async () => {
  let fail = false,
    resolve;
  const s = session(async () => {
    if (fail) return new Promise((r) => (resolve = r));
    return structuredClone(content);
  });
  await s.open();
  s.edit({ ...s.draft, company: "編集中" });
  fail = true;
  const first = s.switchTo(2026, 11, "discard");
  expect(await s.switchTo(2027, 1)).toBe("busy");
  resolve(structuredClone(content));
  await first;
  expect(s.month).toBe(11);
  const f = session(async () => {
    if (fail) throw Error("失敗");
    return structuredClone(content);
  });
  fail = false;
  await f.open();
  f.edit({ ...f.draft, company: "残す" });
  fail = true;
  await expect(f.switchTo(2026, 11, "discard")).rejects.toThrow();
  expect(f.draft.company).toBe("残す");
});
