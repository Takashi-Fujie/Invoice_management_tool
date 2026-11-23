import React from "react";
import { detailMoney } from "./presentation.mjs";

export function SaveBar({
  year,
  month,
  dirty,
  ready,
  busy,
  valid,
  saving,
  saveError,
  saveBlocked = false,
  onRetry,
  invoice,
}: {
  year: number;
  month: number;
  dirty: boolean;
  ready: boolean;
  busy: boolean;
  valid: boolean;
  saving: boolean;
  saveError: string;
  saveBlocked?: boolean;
  onRetry: () => void;
  invoice?: number | null;
}) {
  const unsaved = ready && dirty;
  const status = !ready
    ? "読み込みが完了していません"
    : saving
      ? "保存中…"
      : busy
        ? "処理中…"
        : saveBlocked
          ? "自動保存を停止しています"
          : dirty && saveError
            ? "自動保存に失敗しました"
            : dirty && !valid
              ? "入力を確認してください"
              : dirty
                ? "自動保存待ち"
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
          {saving || busy || !ready ? "…" : unsaved ? "!" : "✓"}
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
              {saveError ||
                (valid
                  ? "入力が止まると自動保存します。"
                  : "各社の業務内容・時間・単価・金額・税込／税抜・値引き・チェックを確認してください。")}
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
      {unsaved && saveError && !saveBlocked && (
        <button
          type="button"
          aria-describedby="mm-save-status"
          disabled={busy || saving || !valid}
          onClick={onRetry}
        >
          再試行
        </button>
      )}
    </div>
  );
}
