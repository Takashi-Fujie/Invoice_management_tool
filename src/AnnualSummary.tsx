import React, { useState } from "react";
import { sortAnnualCompanies } from "./annual.mjs";
import { summaryDetails, amountValue, detailMoney } from "./presentation.mjs";
import { Icon } from "./Icon";
export const annualDetails = summaryDetails;
type Amounts = { invoice: number | null } & Record<
  (typeof annualDetails)[number][0] | "invoice",
  number | null
>;
type Month = Amounts & { status: string };
export type AnnualData = {
  year: number;
  rows: {
    id: string;
    name: string;
    months: (Month | null)[];
    total: Amounts;
  }[];
  total: { months: Amounts[]; total: Amounts };
};
const money = (value: number | null) =>
  value === null ? "入力を確認" : value.toLocaleString("ja-JP");
export function StatusIcon({ status }: { status: string }) {
  const label =
    status === "入金済み"
      ? status
      : status === "請求済"
        ? "請求済・未入金"
        : "未請求";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`annual-status ${status === "入金済み" ? "paid" : status === "請求済" ? "invoiced" : "draft"}`}
    >
      {status === "入金済み" ? "済" : status === "請求済" ? "待" : "未"}
    </span>
  );
}
export function AnnualTable({
  data,
  expanded,
  onToggle,
}: {
  data: AnnualData;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  type Column = "name" | "total" | number;
  const [sort, setSort] = useState<{
    column: Column;
    direction: "ascending" | "descending";
  }>({ column: "name", direction: "ascending" });
  const companies: AnnualData["rows"] = sortAnnualCompanies(data.rows, sort);
  const heading = (column: Column, label: string, text = label) => (
    <th
      key={column}
      scope="col"
      aria-sort={sort.column === column ? sort.direction : undefined}
    >
      <button
        className="annual-sort sort-heading"
        aria-label={`${label}で並び替え`}
        onClick={() =>
          setSort((current) => ({
            column,
            direction:
              current.column === column
                ? current.direction === "ascending"
                  ? "descending"
                  : "ascending"
                : column === "name"
                  ? "ascending"
                  : "descending",
          }))
        }
      >
        {text}
        <span aria-hidden="true">
          {sort.column === column
            ? sort.direction === "ascending"
              ? "↑"
              : "↓"
            : "↕"}
        </span>
      </button>
    </th>
  );
  const link = (month: number) => `/?year=${data.year}&month=${month}`;
  const toggle = (id: string, name: string) => (
    <button
      className="annual-toggle expand-button"
      aria-label={`${name}の金額内訳`}
      aria-expanded={expanded.has(id)}
      aria-controls={`annual-details-${id}`}
      onClick={() => onToggle(id)}
    >
      <span className={expanded.has(id) ? "rotated" : ""}>
        <Icon name="right" size={13} />
      </span>
      <span className="annual-company-name" title={name}>
        {name}
      </span>
    </button>
  );
  const cell = (
    record: Month | null,
    month: number,
    key: keyof Amounts,
    status = false,
  ) =>
    record ? (
      <a
        href={link(month)}
        className="annual-amount month-link"
        aria-label={`${data.year}年${month}月の月次入力へ`}
      >
        <span>{detailMoney(key, amountValue(record, key))}</span>
        {status && <StatusIcon status={record.status} />}
      </a>
    ) : (
      <span className="annual-missing">—</span>
    );
  return (
    <div
      className="annual-scroll"
      tabIndex={0}
      aria-label="年間集計の横スクロール"
    >
      <table
        className="annual-table"
        aria-label={`${data.year}年の会社別年間集計`}
      >
        <thead>
          <tr>
            {heading("name", "会社名", "会社名")}
            {Array.from({ length: 12 }, (_, index) =>
              heading(index + 1, `${index + 1}月`),
            )}
            {heading("total", "年合計")}
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <React.Fragment key={company.id}>
              <tr aria-label={`${company.name}の請求額`}>
                <th scope="row">{toggle(company.id, company.name)}</th>
                {company.months.map((record, index) => (
                  <td key={index}>
                    {cell(record, index + 1, "invoice", true)}
                  </td>
                ))}
                <td className="annual-year-total year-total">
                  {money(company.total.invoice)}
                </td>
              </tr>
              {expanded.has(company.id) &&
                annualDetails.map(([key, label], index) => (
                  <tr
                    key={key}
                    id={
                      index === 0 ? `annual-details-${company.id}` : undefined
                    }
                    className={`annual-detail ${key}`}
                    aria-label={`${company.name}の${label}内訳`}
                  >
                    <th scope="row">{label}</th>
                    {company.months.map((record, index) => (
                      <td key={index}>{cell(record, index + 1, key)}</td>
                    ))}
                    <td className="annual-year-total year-total">
                      {detailMoney(key, amountValue(company.total, key))}
                    </td>
                  </tr>
                ))}
            </React.Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{toggle("__all", "全社合計")}</th>
            {data.total.months.map((amount, index) => (
              <td key={index}>{money(amount.invoice)}</td>
            ))}
            <td className="annual-year-total year-total">
              {money(data.total.total.invoice)}
            </td>
          </tr>
          {expanded.has("__all") &&
            annualDetails.map(([key, label], index) => (
              <tr
                key={key}
                id={index === 0 ? "annual-details-__all" : undefined}
                className={`annual-detail ${key}`}
                aria-label={`全社合計の${label}内訳`}
              >
                <th scope="row">{label}</th>
                {data.total.months.map((amount, index) => (
                  <td key={index}>
                    {detailMoney(key, amountValue(amount, key))}
                  </td>
                ))}
                <td className="annual-year-total year-total">
                  {detailMoney(key, amountValue(data.total.total, key))}
                </td>
              </tr>
            ))}
        </tfoot>
      </table>
    </div>
  );
}
