import React from "react";
import { detailMoney } from "./presentation.mjs";

export function SaveBar({
  year,
  month,
  dirty,
  ready,
  busy,
  valid,
  onSave,
  invoice,
}: {
  year: number;
  month: number;
  dirty: boolean;
  ready: boolean;
  busy: boolean;
  valid: boolean;
  onSave: () => void;
  invoice?: number | null;
}) {
  const unsaved = ready && dirty;
  const status = busy
    ? "処理中…"
    : !ready
      ? "読み込みが完了していません"
      : dirty
        ? "未保存の変更があります"
        : "保存済み";
  return (
    <div className={`mm-savegroup save-dock${unsaved ? " is-dirty" : ""}`}>
      <div
        id="mm-save-status"
        role="status"
        aria-atomic="true"
        className="mm-save-status save-state"
      >
        <span className="mm-save-indicator save-state-icon" aria-hidden="true">
          {unsaved ? "!" : busy || !ready ? "…" : "✓"}
        </span>
        <div className="mm-save-copy">
          <div className="mm-save-heading save-state-heading">
            <strong>{status}</strong>
            {ready && (
              <span className="mm-save-period">
                {year}年{month}月 · 全社分
              </span>
            )}
          </div>
          {unsaved && (
            <p className={valid ? "mm-save-hint" : "mm-error"}>
              {valid
                ? "「変更を保存」を押して確定してください。"
                : "各社の業務内容・時間・単価・金額・税込／税抜・値引き・チェックを確認してください。"}
            </p>
          )}
        </div>
      </div>
      {ready && invoice !== undefined && (
        <div className="dock-total">
          <small>当月請求額 · 全社合計</small>
          <strong>{detailMoney("invoice", invoice, true)}</strong>
        </div>
      )}
      <button
        type="button"
        className="mm-save-button save-button"
        aria-describedby="mm-save-status"
        disabled={busy || !ready || !valid || !dirty}
        onClick={onSave}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
        </svg>
        {busy ? "処理中…" : "変更を保存"}
      </button>
    </div>
  );
}
