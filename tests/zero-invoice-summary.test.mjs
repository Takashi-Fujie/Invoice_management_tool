import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { monthSummary } from "../src/summary.mjs";
import { MonthlySummary } from "../src/MonthlySummary.tsx";
import { prepareMonth } from "../src/month.mjs";
import { Session } from "../src/session.mjs";
import { createApp } from "../server/app.mjs";

const row = (id, amount, patch = {}) => ({
  id,
  description: "制作費（架空）",
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
const company = (id, rows = [], withholdingAmount = 0) => ({
  id,
  name: `架空会社${id}`,
  revision: 0,
  rows,
  invoiced: false,
  paid: false,
  withholdingAmount,
});
const render = (companies, month = 11) =>
  renderToStaticMarkup(
    React.createElement(MonthlySummary, {
      data: monthSummary(companies),
      year: 2026,
      month,
    }),
  );
const visibleNames = (html) =>
  [...html.matchAll(/<tr aria-label="(.*?)の月次集計">/g)].map((m) => m[1]);

test("S29-T01：請求額0円だけ非表示にし、正額・負額・入力確認の会社を表示する", () => {
  const companies = [
    company("空"),
    company("0円明細", [row("zero", 0)]),
    company("相殺", [row("offset", 1100)], 1100),
    company("正", [row("positive", 100)]),
    company("負", [row("negative", 100)], 101),
    company("入力確認", [
      row("invalid", 100, { discountEnabled: true, discountRate: "" }),
    ]),
  ];
  const before = structuredClone(companies);
  const html = render(companies);
  expect(visibleNames(html)).toEqual([
    "架空会社正",
    "架空会社負",
    "架空会社入力確認",
    "全社合計",
  ]);
  expect(html).toContain("-¥1");
  expect(html).toContain("入力を確認");
  expect(companies).toEqual(before);
});

test("S29-T02：明細額・税・値引き・調整・源泉変更で非表示と再表示が切り替わり、入力と他社を保つ", () => {
  const cases = [
    [
      company("明細", [row("amount", 0)]),
      (c) => {
        c.rows[0].amount = 1;
      },
    ],
    [
      company("税", [row("tax", 100)], 100),
      (c) => {
        c.rows[0].priceMode = "exclusive";
      },
    ],
    [
      company("値引き", [row("discount", 100, { discountEnabled: true })], 98),
      (c) => {
        c.rows[0].discountEnabled = false;
      },
    ],
    [
      company("調整", [
        row("fee", 100),
        row("adjustment", -100, { rewardType: "adjustment" }),
      ]),
      (c) => {
        c.rows[1].amount = -99;
      },
    ],
    [
      company("源泉", [row("withheld", 100)], 100),
      (c) => {
        c.withholdingAmount = 99;
      },
    ],
  ];
  for (const [target, change] of cases) {
    const other = company("他社", [row("other", 200)]);
    const companies = [target, other];
    const original = structuredClone(companies);
    expect(visibleNames(render(companies))).toEqual([other.name, "全社合計"]);
    change(target);
    const edited = structuredClone(companies);
    expect(visibleNames(render(companies))).toEqual([
      target.name,
      other.name,
      "全社合計",
    ]);
    expect(companies).toEqual(edited);
    expect(other).toEqual(original[1]);
    companies[0] = original[0];
    expect(visibleNames(render(companies))).toEqual([other.name, "全社合計"]);
  }
});

test("S29-T03：非表示会社の税・値引き・調整・源泉を含め全社合計のすべての内訳を保持する", () => {
  const companies = [
    company(
      "相殺",
      [
        row("fee", 1000, { priceMode: "exclusive", discountEnabled: true }),
        row("travel", 110, { rewardType: "travel" }),
        row("expense", 220, { rewardType: "expense" }),
        row("adjustment", -1, { rewardType: "adjustment" }),
      ],
      1407,
    ),
    company("表示", [row("visible", 100)]),
  ];
  const summary = monthSummary(companies);
  expect(summary.rows[0].invoice).toBe(0);
  expect(summary.total).toMatchObject({
    invoice: 100,
    withheld: 1407,
    gross: 1507,
    fee: 1100,
    travel: 110,
    expense: 220,
    net: 1391,
    tax: 139,
    discount: 22,
    adjustment: -1,
  });
  const html = render(companies);
  expect(visibleNames(html)).toEqual(["架空会社表示", "全社合計"]);
  const footer = html.match(/<tfoot>(.*?)<\/tfoot>/)[1];
  expect(
    [...footer.matchAll(/<td data-amount-key="[^"]+">(.*?)<\/td>/g)].map(
      (m) => m[1],
    ),
  ).toEqual([
    "¥100",
    "¥1,407",
    "¥1,507",
    "-¥1",
    "-¥22",
    "¥1,530",
    "¥139",
    "¥1,391",
    "¥220",
    "¥110",
    "¥1,100",
  ]);
});

test("S29-T04：全社0円でも合計行を残し、保存・月往復・再読込で会社と明細を保持する", async () => {
  const app = createApp({ path: ":memory:" });
  const headers = {
    host: "127.0.0.1:8787",
    origin: "http://127.0.0.1:8787",
    "x-invoice-request": "1",
  };
  let writes = 0;
  const api = {
    load: async (y, m) =>
      (await app.inject({ url: `/api/month/${y}/${m}`, headers })).json(),
    save: async (data, y, m) => {
      writes++;
      const response = await app.inject({
        method: "PUT",
        url: `/api/month/${y}/${m}`,
        headers,
        payload: prepareMonth(data, y, m),
      });
      expect(response.statusCode).toBe(200);
      return response.json();
    },
  };
  try {
    const session = new Session(api, new Date(2026, 10, 2));
    await session.open();
    session.edit({
      companies: [company("相殺", [row("saved", 1100)], 1100), company("空")],
    });
    await session.save();
    const saved = structuredClone(session.draft);
    const counts = app.store.counts();
    expect(visibleNames(render(session.draft.companies))).toEqual(["全社合計"]);
    expect(session.draft).toEqual(saved);
    await session.switchTo(2026, 12);
    expect(visibleNames(render(session.draft.companies, 12))).toEqual([
      "全社合計",
    ]);
    await session.switchTo(2026, 11);
    await session.open();
    expect(session.draft).toEqual(saved);
    expect(session.draft.companies[0].rows[0].id).toBe("saved");
    expect(visibleNames(render(session.draft.companies))).toEqual(["全社合計"]);
    expect(monthSummary(session.draft.companies).total.gross).toBe(1100);
    expect(app.store.counts()).toEqual(counts);
    expect(writes).toBe(1);
    expect(session.dirty).toBe(false);
  } finally {
    await app.close();
  }
});
