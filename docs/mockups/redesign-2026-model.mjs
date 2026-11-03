import { changeReward } from "../../src/reward.mjs";
import { prepareMonth } from "../../src/month.mjs";
import { monthSummary } from "../../src/summary.mjs";
import { changeChecks } from "../../src/checks.mjs";
import { isCompanyVisible } from "../../src/company-visibility.mjs";

export const brand = "請求管理ツール";
export const details = [
  ["withheld", "源泉徴収"],
  ["gross", "小計"],
  ["adjustment", "調整額"],
  ["discount", "値引き"],
  ["taxIncluded", "税込金額"],
  ["tax", "消費税（10%）"],
  ["net", "税抜合計"],
  ["expense", "立替経費"],
  ["travel", "交通費"],
  ["fee", "報酬額"],
];
export const money = (n) =>
  n == null ? "入力を確認" : n.toLocaleString("ja-JP");
export function newRow(id = crypto.randomUUID()) {
  return {
    id,
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
  };
}
const masters = [
  { id: "a", name: "青葉デザイン室（架空）" },
  { id: "b", name: "白波スタジオ（架空）" },
  { id: "c", name: "こもれび企画（架空）" },
];
function fixture(month) {
  const descriptions = [
    "Webサイト制作",
    "デザイン調整",
    "バナー制作",
    "打合せの交通費",
    "SNS画像制作",
    "印刷代の立替",
    "特設ページ制作",
    "ロゴ展開",
    "端数調整",
    "写真のレタッチ",
  ];
  return {
    companies: masters.map((c, ci) => ({
      ...c,
      revision: 0,
      visible: ci < 2,
      withholdingAmount: ci === 0 ? 6400 : 0,
      invoiced: ci === 1 || (ci === 0 && month < 8),
      paid: (ci === 1 && month < 10) || (ci === 0 && month < 8),
      rows:
        ci === 2 && ![3, 6, 9].includes(month)
          ? []
          : descriptions.slice(0, ci === 2 ? 2 : 10).map((description, i) => {
              let row = {
                ...newRow(`${c.id}-${month}-${i}`),
                description,
                amount:
                  [
                    60000, 38400, 45000, 1800, 18000, 2400, 32000, 16000, -120,
                    8000,
                  ][i] + (ci ? 5000 : 0),
              };
              if (i === 1)
                row = {
                  ...row,
                  rewardType: "hourly",
                  hours: "8",
                  rate: ci ? "5425" : "4800",
                };
              if (i === 3 || i === 5)
                row = {
                  ...row,
                  rewardType: i === 3 ? "travel" : "expense",
                  priceMode: "inclusive",
                };
              if (i === 8)
                row = { ...row, rewardType: "adjustment", amount: -120 };
              if (i === 2)
                row = {
                  ...row,
                  discountEnabled: true,
                  discountRate: month < 10 ? "1.3" : "2",
                };
              if (i === 0) row.withholdingEnabled = true;
              const factor = [
                0.63, 0.72, 0.8, 0.75, 0.9, 1.12, 1.02, 0.88, 1.1, 0.95, 1,
                1.16,
              ][month - 1];
              if (row.rewardType === "hourly") {
                row.hours = String(Math.round(8 * factor * 4) / 4);
                row = changeReward(row, {});
              } else if (row.rewardType !== "adjustment")
                row.amount = Math.round(row.amount * factor);
              return row;
            }),
    })),
  };
}
function displaySummary(companies) {
  const summary = monthSummary(companies);
  const withTaxIncluded = (row) => ({
    ...row,
    taxIncluded:
      row.net === null || row.tax === null ? null : row.net + row.tax,
  });
  return {
    rows: summary.rows.map(withTaxIncluded),
    total: withTaxIncluded(summary.total),
  };
}
const sum = (records) =>
  Object.fromEntries(
    ["invoice", ...details.map(([k]) => k)].map((k) => [
      k,
      records.some((r) => r?.[k] === null)
        ? null
        : records.reduce((n, r) => n + (r?.[k] ?? 0), 0),
    ]),
  );

export function createMock() {
  let catalog = structuredClone(masters);
  const saved = new Map(
    Array.from({ length: 12 }, (_, i) => [`2026-${i + 1}`, fixture(i + 1)]),
  );
  const s = {
    year: 2026,
    month: 11,
    view: "monthly",
    draft: fixture(11),
    base: fixture(11),
    get dirty() {
      return JSON.stringify(this.draft) !== JSON.stringify(this.base);
    },
    get valid() {
      try {
        prepareMonth(this.draft, this.year, this.month);
        return true;
      } catch {
        return false;
      }
    },
    get summary() {
      return displaySummary(this.draft.companies);
    },
    visible() {
      return this.draft.companies.filter((c) =>
        isCompanyVisible(c, this.year, this.month),
      );
    },
    getMonth(year, month) {
      const source = saved.get(`${year}-${month}`);
      return {
        companies: catalog.map((master) => {
          const existing = source?.companies.find((c) => c.id === master.id);
          return existing
            ? { ...structuredClone(existing), name: master.name }
            : {
                ...master,
                revision: 0,
                visible: false,
                rows: [],
                withholdingAmount: 0,
                invoiced: false,
                paid: false,
              };
        }),
      };
    },
    updateRow(companyId, rowId, patch) {
      const c = this.draft.companies.find((c) => c.id === companyId);
      if (c.invoiced || c.paid) throw Error("請求済の明細は変更できません。");
      c.rows = c.rows.map((r) => (r.id === rowId ? changeReward(r, patch) : r));
    },
    removeRow(companyId, rowId) {
      const c = this.draft.companies.find((c) => c.id === companyId);
      if (c.invoiced || c.paid) throw Error("請求済の明細は変更できません。");
      c.rows = c.rows.filter((r) => r.id !== rowId);
    },
    setCheck(companyId, key, value) {
      this.draft.companies = this.draft.companies.map((c) =>
        c.id === companyId ? changeChecks(c, key, value) : c,
      );
    },
    save() {
      const next = prepareMonth(this.draft, this.year, this.month);
      catalog = next.companies.map(({ id, name }) => ({ id, name }));
      saved.set(`${this.year}-${this.month}`, structuredClone(next));
      this.draft = structuredClone(next);
      this.base = structuredClone(next);
    },
    move(year, month, view, choice) {
      if (
        !Number.isInteger(year) ||
        year < 1 ||
        year > 9999 ||
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12
      )
        throw Error("年・月を確認してください。");
      if (this.year === year && this.month === month && this.view === view)
        return "same";
      if (this.dirty && !choice) return "confirm";
      if (choice === "save") this.save();
      this.year = year;
      this.month = month;
      this.view = view;
      this.draft = this.getMonth(year, month);
      this.base = structuredClone(this.draft);
      return "changed";
    },
    annual() {
      const months = Array.from({ length: 12 }, (_, i) =>
        displaySummary(this.getMonth(this.year, i + 1).companies),
      );
      const rows = catalog.map((c) => {
        const records = months.map((m, i) => {
          const source = this.getMonth(this.year, i + 1).companies.find(
            (x) => x.id === c.id,
          );
          return source?.rows.length ? m.rows.find((x) => x.id === c.id) : null;
        });
        return { ...c, months: records, total: sum(records) };
      });
      return {
        rows,
        total: {
          months: months.map((m) => m.total),
          total: sum(months.map((m) => m.total)),
        },
      };
    },
  };
  return s;
}
