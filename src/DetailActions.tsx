import React from "react";

export function PreviousMonthAction({
  rowCount,
  companyId,
  companyName,
  blocked,
  busy,
  message,
  onCopy,
}: {
  rowCount: number;
  companyId: string;
  companyName: string;
  blocked: string;
  busy: boolean;
  message: string;
  onCopy: () => void;
}) {
  if (rowCount > 0) return null;
  return (
    <div className="mm-copy-actions previous-month">
      <button
        type="button"
        aria-label={`${companyName}の前月からコピー`}
        aria-describedby={`copy-result-${companyId}`}
        disabled={busy || !!blocked}
        onClick={onCopy}
      >
        前月からコピー
      </button>
      <p
        id={`copy-result-${companyId}`}
        role="status"
        aria-label={`${companyName}のコピー結果`}
        aria-live="polite"
      >
        {blocked || message || "前月の保存済み報酬明細をコピーします。"}
      </p>
    </div>
  );
}

export function DeleteRowButton({
  companyName,
  index,
  disabled,
  onDelete,
}: {
  companyName: string;
  index: number;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      className="mm-delete-row delete-row icon-button"
      title="明細を削除"
      aria-label={`${companyName}の${index + 1}行目を削除`}
      disabled={disabled}
      onClick={onDelete}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
      </svg>
    </button>
  );
}
