import { companyTotals } from "./reward.mjs";

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

export function monthSummary(companies) {
  const rows = companies.map((company) => {
    const totals = companyTotals(company.rows);
    const invalidHourly = company.rows.some(
      (row) =>
        row.rewardType === "hourly" &&
        row.hours &&
        row.rate &&
        row.amount === null,
    );
    const invalid = invalidHourly || totals.invalidDiscount;
    const withheld = company.withholdingAmount ?? 0;
    return {
      id: company.id,
      name: company.name,
      status: company.paid
        ? "入金済み"
        : company.invoiced
          ? "請求済"
          : "請求前",
      invoice: invalid ? null : totals.invoice - withheld,
      withheld,
      gross: invalid ? null : totals.invoice,
      fee: invalidHourly ? null : totals.fee,
      travel: totals.travel,
      expense: totals.expense,
      adjustment: totals.adjustment,
      net: invalid ? null : totals.net,
      tax: invalid ? null : totals.tax,
      discount: invalid ? null : (totals.discount ?? 0),
    };
  });
  const total = {
    id: "total",
    name: "全社合計",
    status: "—",
    invoice: 0,
    withheld: 0,
    gross: 0,
    fee: 0,
    travel: 0,
    expense: 0,
    adjustment: 0,
    net: 0,
    tax: 0,
    discount: 0,
  };
  for (const key of amountKeys) {
    total[key] = rows.some((row) => row[key] === null)
      ? null
      : rows.reduce((sum, row) => sum + row[key], 0);
  }
  return { rows, total };
}
