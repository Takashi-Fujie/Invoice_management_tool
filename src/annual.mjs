import { monthSummary } from "./summary.mjs";
const keys = [
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
function sum(rows) {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      rows.some((row) => row[key] === null)
        ? null
        : rows.reduce((n, row) => n + row[key], 0),
    ]),
  );
}
export function annualSummary(year, months) {
  const companies = new Map();
  const monthly = months.map(({ month, data, registeredIds }) => {
    const registered = new Set(registeredIds);
    const summary = monthSummary(data.companies);
    for (const row of summary.rows) {
      if (!companies.has(row.id))
        companies.set(row.id, {
          id: row.id,
          name: row.name,
          months: Array(12).fill(null),
        });
      const company = companies.get(row.id);
      company.name = row.name;
      if (registered.has(row.id)) company.months[month - 1] = row;
    }
    return {
      month,
      total: sum(summary.rows.filter((row) => registered.has(row.id))),
    };
  });
  const rows = [...companies.values()].map((row) => ({
    ...row,
    total: sum(row.months.filter(Boolean)),
  }));
  const totals = Array.from(
    { length: 12 },
    (_, index) => monthly.find((m) => m.month === index + 1)?.total ?? sum([]),
  );
  return { year, rows, total: { months: totals, total: sum(totals) } };
}

/**
 * @template {{name:string,total:{invoice:number|null},months:({invoice:number|null}|null)[]}} T
 * @param {T[]} rows
 * @param {{column?:"name"|"total"|number,direction?:"ascending"|"descending"}} [options]
 * @returns {T[]}
 */
export function sortAnnualCompanies(rows, options = {}) {
  const { column = "name", direction = "ascending" } = options;
  const byName = (a, b) => a.name.localeCompare(b.name, "ja");
  const multiplier = direction === "ascending" ? 1 : -1;
  const amount = (company) =>
    column === "total"
      ? company.total.invoice
      : company.months[column - 1]?.invoice;
  return rows
    .filter((company) => company.total.invoice !== 0)
    .sort((a, b) => {
      if (column === "name") return multiplier * byName(a, b);
      const left = amount(a),
        right = amount(b);
      if (left == null) return right == null ? byName(a, b) : 1;
      if (right == null) return -1;
      return multiplier * (left - right) || byName(a, b);
    });
}
