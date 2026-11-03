import React from "react";
import { detailMoney } from "./presentation.mjs";

type Amount = number | null;
type SummaryRow = {
  id: string;
  name: string;
  status: string;
  invoice: Amount;
  withheld: Amount;
  gross: Amount;
  fee: Amount;
  travel: Amount;
  expense: Amount;
  net: Amount;
  tax: Amount;
  discount: Amount;
  adjustment: Amount;
};
const columns = [
  ["fee", "報酬額"],
  ["travel", "交通費"],
  ["expense", "立替経費"],
  ["net", "税抜合計"],
  ["tax", "消費税"],
  ["discount", "値引き"],
  ["adjustment", "調整額"],
  ["gross", "小計"],
  ["withheld", "源泉徴収額"],
  ["invoice", "請求額"],
] as const;
function SummaryLine({ row }: { row: SummaryRow }) {
  return (
    <tr aria-label={`${row.name}の月次集計`}>
      <th scope="row">{row.name}</th>
      <td
        className={`mm-summary-status ${row.status === "入金済み" ? "status-paid" : row.status === "請求済" ? "status-invoiced" : ""}`}
      >
        {row.status}
      </td>
      {columns.map(([key]) => (
        <td key={key}>{detailMoney(key, row[key], true)}</td>
      ))}
    </tr>
  );
}
export function MonthlySummary({
  data,
  year,
  month,
}: {
  data: { rows: SummaryRow[]; total: SummaryRow };
  year: number;
  month: number;
}) {
  return (
    <section className="mm-monthly-summary" aria-label="当月の会社別集計">
      <div className="mm-summary-heading">
        <h2>当月の会社別集計</h2>
        <p>
          {year}年{month}月 ·
          報酬額・交通費・立替経費は入力額の合計。請求額は源泉控除後の入金予定額、税抜合計・消費税は値引き前です。
        </p>
      </div>
      <div
        className="mm-summary-scroll"
        tabIndex={0}
        aria-label="会社別集計の横スクロール"
      >
        <table className="mm-summary-table" aria-label="当月の会社別集計">
          <thead>
            <tr>
              <th scope="col">会社名</th>
              <th scope="col">ステータス</th>
              {columns.map(([key, label]) => (
                <th scope="col" key={key}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows
              .filter((row) => row.invoice !== 0)
              .map((row) => (
                <SummaryLine key={row.id} row={row} />
              ))}
          </tbody>
          <tfoot>
            <SummaryLine row={data.total} />
          </tfoot>
        </table>
      </div>
    </section>
  );
}
