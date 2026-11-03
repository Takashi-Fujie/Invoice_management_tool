import React from "react";
import { amountValue, detailMoney, summaryDetails } from "./presentation.mjs";
export function CompanyAmounts({
  summary,
  withholdingInput,
}: {
  summary: { name: string; invoice: number | null };
  withholdingInput: React.ReactNode;
}) {
  return (
    <div
      className="company-amounts"
      aria-label={`${summary.name}の請求額と内訳`}
    >
      <div className="company-amounts-main">
        <span className="company-invoice">
          <small>請求額</small>
          <b>{detailMoney("invoice", summary.invoice, true)}</b>
        </span>
        <label className="withholding">源泉徴収{withholdingInput}</label>
      </div>
      <div className="company-breakdown">
        {summaryDetails
          .filter(([key]) => key !== "withheld")
          .map(([key, label]) => (
            <span
              key={key}
              className={`breakdown-item ${key}`}
              data-amount-key={key}
            >
              <span>{label}</span>
              <strong>
                {detailMoney(key, amountValue(summary, key), true)}
              </strong>
            </span>
          ))}
      </div>
    </div>
  );
}
