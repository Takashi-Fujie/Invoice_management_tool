import React, { useState } from "react";
import type { Company } from "./types";
import { visibilityBlockReason } from "./company-visibility.mjs";

export function CompanyManager({
  companies,
  year,
  month,
  busy,
  createCompany,
  onApply,
  onCancel,
  onCopy,
}: {
  companies: Company[];
  year: number;
  month: number;
  busy: boolean;
  createCompany: (name: string) => Company;
  onApply: (companies: Company[]) => void;
  onCancel: () => void;
  onCopy: (companies: Company[]) => Promise<{
    companies: Company[];
    year: number;
    month: number;
    count: number;
  }>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(companies));
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  async function copy() {
    if (busy) return;
    setError("");
    try {
      const copied = await onCopy(draft);
      setDraft(copied.companies);
      setResult(
        `${copied.year}年${copied.month}月の表示設定をコピーしました。` +
          (copied.count
            ? `この月に${copied.count}社を表示します。`
            : "表示する会社はありません。"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "前月の読取に失敗しました。");
    }
  }
  function add() {
    if (busy) return;
    if (!name.trim() || name.length > 80) {
      setError("会社名を1〜80文字で入力してください。");
      return;
    }
    setDraft([...draft, createCompany(name.trim())]);
    setName("");
    setError("");
  }
  return (
    <form
      className="mm-company-manager"
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          !e.nativeEvent.isComposing &&
          e.keyCode !== 229 &&
          (e.target as HTMLElement).tagName !== "BUTTON"
        )
          e.preventDefault();
      }}
    >
      <p className="mm-manager-period">
        {year}年{month}月
      </p>
      <p>
        この月に表示する会社を選んでください。入力のある会社は非表示にできません。
      </p>
      <button
        type="button"
        disabled={busy || (year === 1 && month === 1)}
        onClick={() => void copy()}
      >
        {busy ? "処理中…" : "前月やりとりのあった会社を表示"}
      </button>
      <p className="mm-manager-note">
        前月の表示・非表示だけをコピーします。明細や金額はコピーしません。
      </p>
      {year === 1 && month === 1 && (
        <p className="mm-manager-note">この対象月には前月がありません。</p>
      )}
      <p className="mm-manager-result" role="status" aria-live="polite">
        {result}
      </p>
      <div className="mm-manager-list-heading">
        <span>会社名</span>
        <span>この月に表示</span>
      </div>
      <div className="mm-manager-list">
        {!draft.length && (
          <p className="mm-manager-note">会社はまだ登録されていません。</p>
        )}
        {draft.map((company) => {
          const reason = visibilityBlockReason(company, year, month);
          return (
            <label key={company.id} className="mm-manager-company">
              <span className="mm-manager-company-name">
                <span>{company.name}</span>
                {reason && (
                  <span className="mm-manager-reason">
                    {reason}・非表示にできません
                  </span>
                )}
              </span>
              <input
                type="checkbox"
                aria-label={`${company.name}のこの月に表示`}
                checked={!!reason || company.visible}
                disabled={busy || !!reason}
                onChange={(e) => {
                  if (busy || reason) return;
                  const visible = e.currentTarget.checked;
                  setDraft(
                    draft.map((c) =>
                      c.id === company.id ? { ...c, visible } : c,
                    ),
                  );
                }}
              />
            </label>
          );
        })}
      </div>
      <div className="mm-manager-add">
        <label htmlFor="new-company-name">新しい会社を追加</label>
        <div className="mm-manager-add-fields">
          <input
            id="new-company-name"
            aria-label="新しい会社名"
            placeholder="会社名"
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={add}>
            追加
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mm-error">
          {error}
        </p>
      )}
      <p className="mm-manager-note">
        「反映する」の後、画面下の「変更を保存」で保存します。
      </p>
      <div className="mm-dialog-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          キャンセル
        </button>
        <button
          type="button"
          className="mm-primary"
          disabled={busy}
          onClick={() => {
            if (!busy)
              onApply(
                draft.map((c) => ({
                  ...c,
                  visible: !!visibilityBlockReason(c, year, month) || c.visible,
                })),
              );
          }}
        >
          反映する
        </button>
      </div>
    </form>
  );
}
