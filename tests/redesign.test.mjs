import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  summaryDetails,
  amountValue,
  detailMoney,
  yearChoices,
} from "../src/presentation.mjs";
import { CompanyAmounts } from "../src/CompanyAmounts.tsx";
import { PeriodControl } from "../src/PeriodControl.tsx";
import { AppHeader } from "../src/AppHeader.tsx";
import { AnnualTable } from "../src/AnnualSummary.tsx";
import { MonthlySummary } from "../src/MonthlySummary.tsx";
import { annualSummary } from "../src/annual.mjs";
import { monthSummary } from "../src/summary.mjs";
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));
const c = {
  id: "a",
  name: "青葉制作（架空）",
  revision: 0,
  visible: true,
  invoiced: false,
  paid: false,
  withholdingAmount: 10,
  rows: [
    {
      id: "a1",
      description: "制作（架空）",
      amount: 1001,
      rewardType: "per_item",
      hours: "",
      rate: "",
      manualAmount: null,
      priceMode: "exclusive",
      feePriceMode: "exclusive",
      travelPriceMode: "inclusive",
      withholdingEnabled: false,
      discountEnabled: true,
      discountRate: "2",
    },
  ],
};
test("S35-T02：税込金額は税抜合計＋税、値引き表示だけ負号にしデータを変えない", () => {
  const totals = monthSummary([c]).rows[0],
    before = structuredClone(totals);
  expect(amountValue(totals, "taxIncluded")).toBe(totals.net + totals.tax);
  expect(detailMoney("discount", totals.discount, true)).toBe("-¥22");
  expect(detailMoney("discount", 0, true)).toBe("¥0");
  expect(detailMoney("discount", null)).toBe("入力を確認");
  expect(amountValue({ ...totals, net: null }, "taxIncluded")).toBeNull();
  expect(detailMoney("adjustment", -3, true)).toBe("-¥3");
  expect(totals).toEqual(before);
});
test("S35-T02：月次カードの承認順・10内訳・源泉入力とマイナス表記", () => {
  const summary = monthSummary([c]).rows[0];
  const html = render(CompanyAmounts, {
    summary,
    withholdingInput: React.createElement("input", {
      "aria-label": "源泉額",
      value: 10,
      readOnly: true,
    }),
  });
  let previous = html.indexOf("請求額");
  for (const [, label] of summaryDetails) {
    const index = html.indexOf(label);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
  expect(html).toContain("-¥22");
  expect(html).toContain('aria-label="源泉額"');
  expect(html).toContain("税込金額");
});
test("S35-T02：月次集計と年間の会社・全社・年合計で値引きは負、税込金額を示し読取データ不変", () => {
  const monthly = monthSummary([c]);
  expect(
    render(MonthlySummary, { data: monthly, year: 2026, month: 11 }),
  ).toContain("-¥22");
  const data = annualSummary(2026, [
      { month: 11, data: { companies: [c] }, registeredIds: ["a"] },
    ]),
    before = structuredClone(data);
  const html = render(AnnualTable, {
    data,
    expanded: new Set(["a", "__all"]),
    onToggle: () => {},
  });
  expect(html).toContain("税込金額");
  expect(html.match(/>-22</g)?.length).toBe(4);
  expect(html).toContain("—");
  expect(data).toEqual(before);
});
test("S35-T03：表示年を中心に前後5年、端は1〜9999で切り詰める", () => {
  expect(yearChoices(2026)).toEqual([
    2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031,
  ]);
  expect(yearChoices(2031)[0]).toBe(2026);
  expect(yearChoices(2031).at(-1)).toBe(2036);
  expect(yearChoices(1)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(yearChoices(9999)).toEqual([9994, 9995, 9996, 9997, 9998, 9999]);
});
test("S35-T03：月の選択はなく年を選べ、処理中と年月の上下限では移動不可", () => {
  const props = {
    year: 2026,
    month: 11,
    yearText: "2026",
    onYearText: () => {},
    onYear: () => {},
    onStep: () => {},
    disabled: false,
  };
  const html = render(PeriodControl, props);
  expect(html).toContain('aria-label="年度を選択"');
  expect(html).not.toContain('<select aria-label="対象月"');
  expect(html).toContain("11月");
  expect(
    render(PeriodControl, { ...props, disabled: true }).match(/disabled=""/g)
      ?.length,
  ).toBe(4);
  expect(render(PeriodControl, { ...props, year: 1, month: 1 })).toMatch(
    /aria-label="前月へ"[^>]*disabled/,
  );
  expect(render(PeriodControl, { ...props, year: 9999, month: 12 })).toMatch(
    /aria-label="翌月へ"[^>]*disabled/,
  );
});
test("S35-T01：本番の名称と画面ナビを示し、モックの案内やキャッチコピーを持ち込まない", () => {
  const html = render(AppHeader, {
    view: "monthly",
    year: 2026,
    onAnnual: () => {},
    disabled: false,
  });
  expect(html).toContain("請求管理ツール");
  expect(html).toContain("年間集計");
  expect(html.match(/請求管理ツール/g)).toHaveLength(1);
  expect(html).not.toContain("架空");
  expect(html).not.toContain("モック");
});
