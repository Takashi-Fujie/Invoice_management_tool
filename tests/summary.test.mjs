import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { monthSummary } from "../src/summary.mjs";
import { MonthlySummary } from "../src/MonthlySummary.tsx";
import { changeReward } from "../src/reward.mjs";
import { prepareMonth } from "../src/month.mjs";
import { Session } from "../src/session.mjs";
import { createApp } from "../server/app.mjs";
const row = (id, amount, patch = {}) => ({
  id,
  description: "原稿制作（架空）",
  amount,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "inclusive",
  feePriceMode: "inclusive",
  travelPriceMode: "inclusive",
  discountEnabled: false,
  discountRate: "2",
  withholdingEnabled: false,
  ...patch,
});
const company = (id, rows, patch = {}) => ({
  id,
  name: `会社${id}（架空）`,
  revision: 0,
  rows,
  invoiced: false,
  paid: false,
  withholdingAmount: 0,
  ...patch,
});
const example = () => [
  company(
    "a",
    [row("a1", 50000, { priceMode: "exclusive", feePriceMode: "exclusive" })],
    { withholdingAmount: 5105 },
  ),
  company("b", [row("b1", 24000)]),
];
test("S33-T01・S15-T01/T05：計算順に並ぶ列順と会社別・全社の内訳を表示し、税・交通費・値引き・源泉変更を反映する", () => {
  const companies = example(),
    before = structuredClone(companies);
  let summary = monthSummary(companies);
  expect(summary.rows[0]).toMatchObject({
    name: "会社a（架空）",
    invoice: 49895,
    withheld: 5105,
    gross: 55000,
    fee: 50000,
    travel: 0,
    net: 50000,
    tax: 5000,
    discount: 0,
  });
  expect(summary.total).toMatchObject({
    invoice: 73895,
    withheld: 5105,
    gross: 79000,
    fee: 74000,
    travel: 0,
    net: 71819,
    tax: 7181,
    discount: 0,
  });
  expect(companies).toEqual(before);
  const html = renderToStaticMarkup(
    React.createElement(MonthlySummary, {
      data: summary,
      year: 2026,
      month: 11,
    }),
  );
  const headings = [...html.matchAll(/<th scope="col">(.*?)<\/th>/g)].map(
    (m) => m[1],
  );
  expect(headings).toEqual([
    "会社名",
    "ステータス",
    "報酬額",
    "交通費",
    "立替経費",
    "税抜合計",
    "消費税",
    "値引き",
    "調整額",
    "小計",
    "源泉徴収額",
    "請求額",
  ]);
  expect(html).toContain("2026年11月");
  expect(html).toContain("当月の会社別集計");
  expect(html).not.toMatch(/<(input|button|select)\b/);
  expect(html).toContain('tabindex="0"');
  companies[0].rows[0].discountEnabled = true;
  companies[0].rows.push(row("a2", 1250, { rewardType: "travel" }));
  summary = monthSummary(companies);
  expect(summary.rows[0]).toMatchObject({
    invoice: 50045,
    gross: 55150,
    net: 51137,
    tax: 5113,
    discount: 1100,
    travel: 1250,
  });
  expect(summary.rows[1]).toEqual(monthSummary(before).rows[1]);
  expect(summary.total).toMatchObject({
    invoice: 74045,
    gross: 79150,
    net: 72956,
    tax: 7294,
    discount: 1100,
  });
  companies[0].withholdingAmount = 60000;
  expect(monthSummary(companies).rows[0].invoice).toBe(-4850);
  expect(
    renderToStaticMarkup(
      React.createElement(MonthlySummary, {
        data: monthSummary(companies),
        year: 2026,
        month: 11,
      }),
    ),
  ).toContain("-¥4,850");
  companies[0].withholdingAmount = null;
  expect(monthSummary(companies).rows[0].invoice).toBe(55150);
});
test("S15-T02：会社追加・名前変更・請求と入金の往復は表示へ反映し、全社の金額を変えない", () => {
  const companies = example(),
    total = monthSummary(companies).total;
  expect(monthSummary(companies).rows[0].status).toBe("請求前");
  for (const [invoiced, paid, status] of [
    [true, false, "請求済"],
    [true, true, "入金済み"],
    [true, false, "請求済"],
    [false, false, "請求前"],
  ]) {
    Object.assign(companies[0], { invoiced, paid });
    expect(monthSummary(companies).rows[0].status).toBe(status);
    expect(monthSummary(companies).total).toEqual(total);
  }
  companies[0].name = "変更会社（架空）";
  expect(monthSummary(companies).rows[0].name).toBe("変更会社（架空）");
  companies.push(company("c", [row("c1", null)]));
  expect(monthSummary(companies).rows[2]).toMatchObject({
    status: "請求前",
    invoice: 0,
    gross: 0,
    net: 0,
    tax: 0,
    discount: 0,
  });
  expect(monthSummary(companies).total).toEqual(total);
  expect(monthSummary([]).total).toMatchObject({
    status: "—",
    invoice: 0,
    withheld: 0,
    gross: 0,
  });
});
test("S15-T03：各会社で丸めた税・値引きを合算し、全社で端数を再計算しない", () => {
  const companies = [
    company("a", [row("a1", 5, { priceMode: "exclusive" })]),
    company("b", [row("b1", 5, { priceMode: "exclusive" })]),
  ];
  expect(monthSummary(companies).total).toMatchObject({
    gross: 10,
    net: 10,
    tax: 0,
  });
  for (const c of companies)
    Object.assign(c.rows[0], { amount: 75, discountEnabled: true });
  const summary = monthSummary(companies);
  expect(summary.rows[0]).toMatchObject({
    gross: 81,
    net: 75,
    tax: 7,
    discount: 1,
  });
  expect(summary.total).toMatchObject({
    gross: 162,
    net: 150,
    tax: 14,
    discount: 2,
  });
});
test("S15-T03：入力不備のある会社と全社は古い金額を出さず、源泉と他社の金額を保ち訂正で戻る", () => {
  const companies = example(),
    other = monthSummary(companies).rows[1];
  Object.assign(companies[0].rows[0], {
    discountEnabled: true,
    discountRate: "",
  });
  let summary = monthSummary(companies);
  for (const item of [summary.rows[0], summary.total])
    expect(item).toMatchObject({
      invoice: null,
      gross: null,
      net: null,
      tax: null,
      discount: null,
      withheld: 5105,
    });
  expect(summary.rows[1]).toEqual(other);
  const html = renderToStaticMarkup(
    React.createElement(MonthlySummary, {
      data: summary,
      year: 2026,
      month: 11,
    }),
  );
  expect(html).toContain("入力を確認");
  expect(html).not.toContain("49,895");
  companies[0].rows[0].discountEnabled = false;
  expect(monthSummary(companies).total.invoice).toBe(73895);
  companies[0].rows[0] = changeReward(companies[0].rows[0], {
    rewardType: "hourly",
    hours: "1000000000",
    rate: "1",
  });
  summary = monthSummary(companies);
  expect(summary.rows[0]).toMatchObject({
    invoice: null,
    fee: null,
    travel: 0,
    withheld: 5105,
  });
  expect(summary.total.fee).toBeNull();
  companies[0].rows[0] = changeReward(companies[0].rows[0], {
    hours: "1.5",
    rate: "3000",
  });
  expect(monthSummary(companies).total).toMatchObject({
    invoice: 23845,
    gross: 28950,
    fee: 28500,
  });
});
test("S15-T04：保存・月切替・再起動で同じ集計を復元し、切替中止・通信失敗では入力と集計を保つ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-summary-")),
    path = join(dir, "fictional.sqlite");
  let app = createApp({ path }),
    fail = false;
  const headers = {
    host: "127.0.0.1:8787",
    origin: "http://127.0.0.1:8787",
    "x-invoice-request": "1",
  };
  const api = {
    load: async (y, m) =>
      (await app.inject({ url: `/api/month/${y}/${m}`, headers })).json(),
    save: async (data, y, m) => {
      if (fail) throw Error("検証用の通信失敗");
      const r = await app.inject({
        method: "PUT",
        url: `/api/month/${y}/${m}`,
        headers,
        payload: prepareMonth(data, y, m),
      });
      expect(r.statusCode).toBe(200);
      return r.json();
    },
  };
  try {
    let session = new Session(api, new Date(2026, 10, 2));
    await session.open();
    session.edit({ companies: example() });
    await session.save();
    const expected = monthSummary(session.draft.companies),
      counts = app.store.counts();
    monthSummary(session.draft.companies);
    expect(app.store.counts()).toEqual(counts);
    await session.switchTo(2026, 10);
    expect(monthSummary(session.draft.companies).total.invoice).toBe(0);
    await session.switchTo(2026, 11);
    expect(monthSummary(session.draft.companies)).toEqual(expected);
    await app.close();
    app = createApp({ path });
    session = new Session(api, new Date(2026, 10, 2));
    await session.open();
    expect(monthSummary(session.draft.companies)).toEqual(expected);
    const draft = structuredClone(session.draft);
    draft.companies[0].withholdingAmount = 60000;
    session.edit(draft);
    const unsaved = monthSummary(session.draft.companies);
    expect(await session.switchTo(2026, 10)).toBe("confirm");
    expect(session.month).toBe(11);
    expect(monthSummary(session.draft.companies)).toEqual(unsaved);
    fail = true;
    await expect(session.save()).rejects.toThrow("通信失敗");
    expect(monthSummary(session.draft.companies)).toEqual(unsaved);
    expect(session.dirty).toBe(true);
    fail = false;
    await session.save();
    await session.open();
    expect(monthSummary(session.draft.companies)).toEqual(unsaved);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
