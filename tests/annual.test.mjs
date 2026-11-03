import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createApp } from "../server/app.mjs";
import { monthSummary } from "../src/summary.mjs";
import { prepareMonth } from "../src/month.mjs";
import { annualSummary, sortAnnualCompanies } from "../src/annual.mjs";
import { AnnualTable } from "../src/AnnualSummary.tsx";
import { AnnualSession, openAnnual } from "../src/annual-session.mjs";

const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const row = (id, amount, patch = {}) => ({
  id,
  description: "制作（架空）",
  amount,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "exclusive",
  feePriceMode: "exclusive",
  travelPriceMode: "inclusive",
  withholdingEnabled: false,
  discountEnabled: false,
  discountRate: "2",
  ...patch,
});
const company = (id, rows, patch = {}) => ({
  id,
  name: `会社${id}（架空）`,
  revision: 0,
  rows,
  invoiced: false,
  paid: false,
  visible: true,
  withholdingAmount: 0,
  ...patch,
});
const fixtures = () => [
  company(
    "a",
    [
      row("a1", 125000),
      row("a2", 1200, { rewardType: "travel", priceMode: "inclusive" }),
      row("a3", 3600, { rewardType: "expense", priceMode: "inclusive" }),
      row("a4", -1, { rewardType: "adjustment" }),
    ],
    { withholdingAmount: 12000 },
  ),
  company("b", [row("b1", 0)]),
];
const amountKeys = [
  "invoice",
  "withheld",
  "gross",
  "fee",
  "travel",
  "expense",
  "net",
  "tax",
  "discount",
  "adjustment",
];
const detailTitles = [
  "源泉徴収",
  "小計",
  "調整額",
  "値引き",
  "税込金額",
  "消費税（10%）",
  "税抜合計",
  "立替経費",
  "交通費",
  "報酬額",
];
function model() {
  return annualSummary(
    2026,
    Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      data: { companies: fixtures() },
      registeredIds: i < 3 ? ["a", "b"] : [],
    })),
  );
}

test("S16-T05/T07：各社各月を既存月次と同じ値で合算し、未登録を0円登録と区別する", () => {
  const input = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    data: { companies: fixtures() },
    registeredIds: i < 2 ? ["a", "b"] : [],
  }));
  const before = structuredClone(input),
    annual = annualSummary(2026, input),
    monthly = monthSummary(fixtures());
  expect(annual.rows).toHaveLength(2);
  expect(annual.rows[0].months[0]).toMatchObject(monthly.rows[0]);
  expect(annual.rows[1].months[0].invoice).toBe(0);
  expect(annual.rows[1].months[2]).toBeNull();
  for (const key of amountKeys) {
    expect(annual.rows[0].total[key]).toBe(monthly.rows[0][key] * 2);
    expect(annual.total.total[key]).toBe(monthly.total[key] * 2);
  }
  expect(annual.total.months[2].invoice).toBe(0);
  expect(input).toEqual(before);
});

test("S16-T01/T02/T03/T04/T06：初期は閉じ、展開時は承認順の10項目と会社だけの月次リンクを表示する", () => {
  const data = model();
  data.rows[0].months[0].status = "入金済み";
  data.rows[0].months[1].status = "請求済";
  const render = (expanded = []) =>
    renderToStaticMarkup(
      React.createElement(AnnualTable, {
        data,
        expanded: new Set(expanded),
        onToggle: () => {},
      }),
    );
  const closed = render();
  expect(closed).not.toContain("の源泉徴収内訳");
  expect(closed).toContain('aria-expanded="false"');
  expect(closed).toContain('href="/?year=2026&amp;month=1"');
  expect(closed).toContain('aria-label="入金済み"');
  expect(closed).toContain('aria-label="請求済・未入金"');
  expect(closed).toContain('aria-label="未請求"');
  const html = render(["a", "__all"]);
  for (const companyName of ["会社a（架空）", "全社合計"]) {
    let previous = -1;
    for (const title of detailTitles) {
      const position = html.indexOf(`${companyName}の${title}内訳`);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
  }
  const footer = html.split("<tfoot>")[1].split("</tfoot>")[0];
  expect(footer).not.toContain("href=");
  expect(footer).not.toContain('aria-label="入金済み"');
  const head = html.split("<thead>")[1].split("</thead>")[0];
  expect(head).toContain("12月");
  expect(head).toContain("年合計");
  expect(html).toContain('scope="row"');
  expect(html).not.toContain('type="checkbox"');
});

test("S16-T05/T08：年間APIは保存済み全12月・別年を区別し、表示設定で除外せず読取のみ", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const load = async (y, m) =>
      (await app.inject({ url: `/api/month/${y}/${m}`, headers })).json();
    const save = async (y, m, companies) => {
      const result = await app.inject({
        method: "PUT",
        url: `/api/month/${y}/${m}`,
        headers,
        payload: prepareMonth({ companies }, y, m),
      });
      expect(result.statusCode).toBe(200);
      return result.json();
    };
    await save(2026, 1, fixtures());
    let next = await load(2026, 12);
    next.companies[0].rows = [row("dec", 5)];
    next.companies[0].visible = true;
    next.companies[0].withholdingAmount = 0;
    next.companies[0].invoiced = true;
    next.companies[0].paid = true;
    next.companies[1].rows = [];
    next.companies[1].visible = false;
    await save(2026, 12, next.companies);
    const saved = await load(2026, 1),
      countBefore = app.store.counts();
    const response = await app.inject({ url: "/api/annual/2026", headers });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    const jan = monthSummary(saved.companies);
    expect(data.rows[0].months[0]).toMatchObject(jan.rows[0]);
    expect(data.rows[1].months[0].invoice).toBe(0);
    expect(data.rows[1].months[11]).toBeNull();
    expect(data.rows[0].months[11].status).toBe("入金済み");
    expect(data.total.total.invoice).toBe(jan.total.invoice + 5);
    for (let m = 1; m <= 12; m++) {
      const monthly = monthSummary((await load(2026, m)).companies);
      for (const key of amountKeys)
        expect(data.total.months[m - 1][key]).toBe(monthly.total[key]);
    }
    const empty = (
      await app.inject({ url: "/api/annual/2025", headers })
    ).json();
    expect(empty.total.total.invoice).toBe(0);
    expect(empty.rows[0].months.every((x) => x === null)).toBe(true);
    expect(app.store.counts()).toEqual(countBefore);
    expect(await load(2026, 1)).toEqual(saved);
    for (const value of ["0", "10000", "abc", "2026.5"]) {
      expect(
        (await app.inject({ url: `/api/annual/${value}`, headers })).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          url: "/api/annual/2026",
          headers: { host: "external.example" },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});

function browser() {
  const listeners = new Set();
  return {
    location: { href: "http://127.0.0.1:8787/annual.html?year=2026" },
    history: {
      pushState(_, __, url) {
        b.location.href = url;
      },
    },
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    pop(url) {
      this.location.href = url;
      for (const fn of listeners) fn();
    },
  };
}
let b;
test("S16-T08：年切替・履歴移動・失敗再試行で旧年の応答を混ぜない", async () => {
  b = browser();
  const calls = [];
  const s = new AnnualSession(
    {
      load: (year) =>
        new Promise((resolve, reject) => calls.push({ year, resolve, reject })),
    },
    b,
  );
  s.start(() => {});
  const first = s.open();
  expect(s.busy).toBe(true);
  const second = s.changeYear(2025);
  expect(s.data).toBeNull();
  expect(s.year).toBe(2025);
  expect(b.location.href).toContain("year=2025");
  calls[1].resolve({ year: 2025 });
  await second;
  calls[0].resolve({ year: 2026 });
  await first;
  expect(s.data).toEqual({ year: 2025 });
  const failed = s.changeYear(2024);
  calls[2].reject(Error("読取失敗"));
  await failed;
  expect(s.error).toBe("読取失敗");
  expect(s.data).toBeNull();
  const retry = s.open();
  calls[3].resolve({ year: 2024 });
  await retry;
  expect(s.error).toBe("");
  expect(s.data.year).toBe(2024);
  b.pop("http://127.0.0.1:8787/annual.html?year=2026");
  expect(s.year).toBe(2026);
  expect(s.data).toBeNull();
  calls[4].resolve({ year: 2026 });
  await Promise.resolve();
  await Promise.resolve();
  expect(s.data.year).toBe(2026);
  expect(() => s.changeYear(0)).toThrow();
  expect(() => s.changeYear(10000)).toThrow();
  s.stop();
});

test("S16-T09：未保存なら確認し、中止と保存失敗では入力を保持し、保存成功後に移動する", async () => {
  const navigations = [];
  const s = {
    year: 2026,
    dirty: true,
    busy: false,
    navigating: false,
    draft: { amount: 100 },
    save: async () => {
      throw Error("保存失敗");
    },
  };
  const navigate = (url) => navigations.push(url);
  expect(await openAnnual(s, navigate)).toBe("confirm");
  expect(navigations).toEqual([]);
  await expect(openAnnual(s, navigate, "save")).rejects.toThrow("保存失敗");
  expect(s.draft).toEqual({ amount: 100 });
  expect(navigations).toEqual([]);
  s.save = async () => {
    s.dirty = false;
  };
  expect(await openAnnual(s, navigate, "save")).toBe("changed");
  expect(navigations).toEqual(["/annual.html?year=2026"]);
  s.dirty = true;
  await openAnnual(s, navigate, "discard");
  expect(navigations).toHaveLength(2);
  s.busy = true;
  expect(await openAnnual(s, navigate)).toBe("busy");
});

test("S16-T10：年合計0円の会社と展開内訳だけを隠し、全社合計・負額・入力確認を保持する", () => {
  const jan = [
    company("zero", [row("z1", 1000)], { withholdingAmount: 1100 }),
    company("positive", [row("p1", 2000)]),
    company("negative", [row("n1", 500)], { withholdingAmount: 600 }),
    company("cancel", [row("c1", 0)], { withholdingAmount: 100 }),
  ];
  const feb = [company("cancel", [row("c2", 100)], { withholdingAmount: 10 })];
  const data = annualSummary(2026, [
    { month: 1, data: { companies: jan }, registeredIds: jan.map((c) => c.id) },
    { month: 2, data: { companies: feb }, registeredIds: ["cancel"] },
  ]);
  const before = structuredClone(data);
  const render = (value, expanded) =>
    renderToStaticMarkup(
      React.createElement(AnnualTable, {
        data: value,
        expanded: new Set(expanded),
        onToggle: () => {},
      }),
    );
  const html = render(data, ["zero", "cancel", "positive", "__all"]);
  expect(html).not.toContain("会社zero（架空）");
  expect(html).not.toContain("会社cancel（架空）");
  expect(html).toContain("会社positive（架空）の請求額");
  expect(html).toContain("会社negative（架空）の請求額");
  const total = data.total.total;
  expect(total.fee).toBe(3600);
  expect(total.withheld).toBe(1810);
  expect(total.invoice).toBe(2150);
  const feeFooter = html
    .split('aria-label="全社合計の報酬額内訳"')[1]
    .split("</tr>")[0];
  expect(feeFooter).toContain("3,600");
  expect(data).toEqual(before);
  const invalid = annualSummary(2026, [
    {
      month: 1,
      data: {
        companies: [
          company("invalid", [
            row("i1", null, { rewardType: "hourly", hours: "1", rate: "100" }),
          ]),
        ],
      },
      registeredIds: ["invalid"],
    },
  ]);
  expect(render(invalid, [])).toContain("会社invalid（架空）の請求額");
  expect(render(invalid, [])).toContain("入力を確認");
  const zeros = annualSummary(2027, [
    {
      month: 1,
      data: {
        companies: jan.map((c) => ({ ...c, rows: [], withholdingAmount: 0 })),
      },
      registeredIds: [],
    },
  ]);
  const empty = render(zeros, ["__all"]);
  expect(empty).not.toContain('の請求額"');
  expect(empty).toContain("全社合計の報酬額内訳");
});

test("S16-T11：初期は会社名順とし、会社名・12か月・年合計に並べ替え見出しを表示する", () => {
  const companies = [
    company("small", [row("s1", 1000)], { name: "さくら（架空）" }),
    company("big", [row("b1", 2000)], { name: "あおい（架空）" }),
    company("tie", [row("t1", 2000)], { name: "かえで（架空）" }),
  ];
  const data = annualSummary(2026, [
    {
      month: 1,
      data: { companies },
      registeredIds: companies.map((c) => c.id),
    },
  ]);
  const before = structuredClone(data);
  for (const expanded of [[], ["small", "big", "__all"]]) {
    const html = renderToStaticMarkup(
      React.createElement(AnnualTable, {
        data,
        expanded: new Set(expanded),
        onToggle: () => {},
      }),
    );
    expect(
      [...html.matchAll(/<tr aria-label="([^"]+)の請求額">/g)].map((m) => m[1]),
    ).toEqual(["あおい（架空）", "かえで（架空）", "さくら（架空）"]);
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('aria-label="会社名で並び替え"');
    expect(html).toContain('aria-label="年合計で並び替え"');
    for (let month = 1; month <= 12; month++)
      expect(html).toContain(`aria-label="${month}月で並び替え"`);
    expect(data).toEqual(before);
  }
});

test("S16-T11：各月・年合計の両方向、同額・未登録・入力確認・0円を扱い、元データを保持する", () => {
  const companies = [
    company("b", [row("b1", 1000)], { name: "かえで（架空）" }),
    company("a", [row("a1", 1000)], { name: "あおい（架空）" }),
    company("c", [row("c1", 3000)], { name: "さくら（架空）" }),
    company("missing", [], { name: "たちばな（架空）" }),
    company(
      "invalid",
      [row("i1", null, { rewardType: "hourly", hours: "1", rate: "100" })],
      { name: "なでしこ（架空）" },
    ),
    company("zero", [row("z1", 0)]),
  ];
  const data = annualSummary(2026, [
    {
      month: 1,
      data: { companies },
      registeredIds: ["a", "b", "c", "invalid", "zero"],
    },
    {
      month: 2,
      data: {
        companies: [
          company("missing", [row("m1", 2000)], { name: "たちばな（架空）" }),
        ],
      },
      registeredIds: ["missing"],
    },
  ]);
  const before = structuredClone(data),
    ids = (sort) => sortAnnualCompanies(data.rows, sort).map((c) => c.id);
  expect(ids({ column: "name", direction: "ascending" })).toEqual([
    "a",
    "b",
    "c",
    "missing",
    "invalid",
  ]);
  expect(ids({ column: "name", direction: "descending" })).toEqual([
    "invalid",
    "missing",
    "c",
    "b",
    "a",
  ]);
  expect(ids({ column: 1, direction: "descending" })).toEqual([
    "c",
    "a",
    "b",
    "missing",
    "invalid",
  ]);
  expect(ids({ column: 1, direction: "ascending" })).toEqual([
    "a",
    "b",
    "c",
    "missing",
    "invalid",
  ]);
  expect(ids({ column: "total", direction: "descending" })).toEqual([
    "c",
    "missing",
    "a",
    "b",
    "invalid",
  ]);
  expect(ids({ column: "total", direction: "ascending" })).toEqual([
    "a",
    "b",
    "missing",
    "c",
    "invalid",
  ]);
  for (let month = 2; month <= 12; month++)
    for (const direction of ["ascending", "descending"]) {
      const sorted = sortAnnualCompanies(data.rows, {
        column: month,
        direction,
      });
      expect(sorted.map((c) => c.id).sort()).toEqual([
        "a",
        "b",
        "c",
        "invalid",
        "missing",
      ]);
    }
  expect(data).toEqual(before);
});
