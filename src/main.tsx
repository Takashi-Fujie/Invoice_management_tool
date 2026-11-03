import { openAnnual } from "./annual-session.mjs";
import { isNonFeeType } from "./reward.mjs";
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PeriodSession } from "./period-url.mjs";
import { changeChecks, validChecks } from "./checks.mjs";
import { amountText } from "./amount.mjs";
import { acceptAmount, prepareMonth } from "./month.mjs";
import {
  changeReward,
  acceptDecimal,
  companyTotals,
  defaultDiscountRate,
  acceptDiscountRate,
} from "./reward.mjs";
import { copyBlockReason, copyPreviousMonth } from "./previous-month.mjs";
import { deleteMonthRow } from "./detail-actions.mjs";
import { PreviousMonthAction, DeleteRowButton } from "./DetailActions";
import { monthSummary } from "./summary.mjs";
import { MonthlySummary } from "./MonthlySummary";
import { SaveBar } from "./SaveBar";
import { AppHeader } from "./AppHeader";
import { PeriodControl } from "./PeriodControl";
import { CompanyAmounts } from "./CompanyAmounts";
import { Icon } from "./Icon";
import "./style.css";
import type { Row, Company, Data } from "./types";
import { CompanyManager } from "./CompanyManager";
import {
  copyPreviousVisibility,
  isCompanyVisible,
} from "./company-visibility.mjs";
async function request(year: number, month: number, data?: Data) {
  const r = await fetch(
    `/api/month/${year}/${month}`,
    data
      ? {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Invoice-Request": "1",
          },
          body: JSON.stringify(data),
        }
      : {},
  );
  if (!r.ok) {
    const e = await r.json().catch(() => ({ message: "通信に失敗しました。" }));
    throw Error(e.message);
  }
  return r.json();
}
const session = new PeriodSession(
  {
    load: (y: number, m: number) => request(y, m),
    save: (d: Data, y: number, m: number) =>
      request(y, m, prepareMonth(d, y, m)),
  },
  window,
);
const integer = (s: string) => (/^-?[0-9]+$/.test(s) ? Number(s) : null);
const emptyRow = (): Row => ({
  id: crypto.randomUUID(),
  description: "",
  amount: null,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "exclusive",
  feePriceMode: "exclusive",
  travelPriceMode: "inclusive",
  withholdingEnabled: false,
  discountEnabled: false,
  discountRate: defaultDiscountRate(session.year, session.month),
});
function Modal({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="閉じる" onClick={onCancel}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function AmountInput({
  value,
  onChange,
  label,
  disabled = false,
  readOnly = false,
  signed = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  readOnly?: boolean;
  signed?: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [raw, setRaw] = useState(value);
  const composing = useRef(false);
  const apply = (input: HTMLInputElement) => {
    if (readOnly) return;
    const next = acceptAmount(value, input.value, signed);
    input.value = next;
    setRaw(next);
    if (next !== value) onChange(next);
  };
  return (
    <input
      className="amount"
      type="text"
      inputMode={signed ? "text" : "numeric"}
      maxLength={editing ? (signed ? 10 : 9) : signed ? 12 : 11}
      aria-label={label}
      placeholder={disabled || readOnly ? undefined : "例：30000"}
      disabled={disabled}
      readOnly={readOnly}
      value={
        readOnly
          ? amountText(value, false)
          : editing
            ? raw
            : amountText(value, false)
      }
      onFocus={() => {
        if (readOnly) return;
        setRaw(value);
        setEditing(true);
      }}
      onBeforeInput={(e) => {
        if (readOnly) {
          e.preventDefault();
          return;
        }
        const event = e.nativeEvent as InputEvent;
        if (
          !composing.current &&
          !event.isComposing &&
          event.data &&
          !(signed ? /^[0-9-]+$/ : /^[0-9]+$/).test(event.data)
        )
          e.preventDefault();
      }}
      onPaste={(e) => {
        if (readOnly) {
          e.preventDefault();
          return;
        }
        const input = e.currentTarget,
          text = e.clipboardData.getData("text");
        const next =
          input.value.slice(0, input.selectionStart ?? 0) +
          text +
          input.value.slice(input.selectionEnd ?? input.value.length);
        if (acceptAmount(value, next, signed) !== next) e.preventDefault();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        apply(e.currentTarget);
      }}
      onChange={(e) => {
        if (composing.current || (e.nativeEvent as InputEvent).isComposing)
          setRaw(e.target.value);
        else apply(e.currentTarget);
      }}
      onBlur={(e) => {
        if (composing.current) {
          composing.current = false;
          apply(e.currentTarget);
        }
        setEditing(false);
      }}
    />
  );
}
function DecimalInput({
  value,
  onChange,
  label,
  disabled,
  placeholder,
  accept = acceptDecimal,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled: boolean;
  placeholder: string;
  accept?: (previous: string, next: string) => string;
}) {
  const [raw, setRaw] = useState(value);
  const composing = useRef(false);
  const apply = (input: HTMLInputElement) => {
    const next = accept(value, input.value);
    input.value = next;
    setRaw(next);
    if (next !== value) onChange(next);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      maxLength={64}
      aria-label={label}
      value={composing.current ? raw : value}
      disabled={disabled}
      placeholder={disabled ? undefined : placeholder}
      onPaste={(e) => {
        const input = e.currentTarget;
        const next =
          input.value.slice(0, input.selectionStart ?? 0) +
          e.clipboardData.getData("text") +
          input.value.slice(input.selectionEnd ?? input.value.length);
        if (accept(value, next) !== next) e.preventDefault();
      }}
      onCompositionStart={() => {
        composing.current = true;
        setRaw(value);
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        apply(e.currentTarget);
      }}
      onChange={(e) => {
        if (composing.current || (e.nativeEvent as InputEvent).isComposing)
          setRaw(e.target.value);
        else apply(e.currentTarget);
      }}
      onBlur={(e) => {
        if (composing.current) {
          composing.current = false;
          apply(e.currentTarget);
        }
      }}
    />
  );
}
function App() {
  const [pendingAnnual, setPendingAnnual] = useState(false);
  const leaving = useRef(false);
  async function annual(choice?: string) {
    await run(async () => {
      const result = await openAnnual(
        session,
        (url: string) => {
          leaving.current = true;
          window.location.assign(url);
        },
        choice,
      );
      if (result === "confirm") setPendingAnnual(true);
    });
  }
  const [managerOpen, setManagerOpen] = useState(false);
  const [copyResults, setCopyResults] = useState<Record<string, string>>({});
  const [, redraw] = useState(0),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [companyDialog, setCompanyDialog] = useState<{
      id: string | null;
    } | null>(null),
    [name, setName] = useState("");
  const [pending, setPending] = useState<{
      year: number;
      month: number;
    } | null>(null),
    [year, setYear] = useState(String(session.year));
  const d = session.draft as Data,
    busy = session.busy || session.navigating;
  const summary = monthSummary(d.companies);
  const refresh = () => {
    redraw((n) => n + 1);
    setYear(String(session.year));
  };
  async function run(task: () => Promise<unknown>) {
    setError("");
    const p = task();
    refresh();
    try {
      await p;
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました。");
      return false;
    } finally {
      refresh();
    }
  }
  const load = async () => {
    if (await run(() => session.open())) setReady(true);
  };
  useEffect(() => {
    session.start((y: number, m: number) => {
      void change(y, m);
    }, refresh);
    void load();
    return () => session.stop();
  }, []);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (session.dirty && !leaving.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  const edit = (data: Data) => {
    session.edit(data);
    redraw((n) => n + 1);
  };
  const update = (id: string, change: (c: Company) => Company) =>
    edit({ companies: d.companies.map((c) => (c.id === id ? change(c) : c)) });
  const updateRow = (companyId: string, rowId: string, patch: Partial<Row>) =>
    update(companyId, (c) => ({
      ...c,
      rows: c.rows.map((r) => (r.id === rowId ? changeReward(r, patch) : r)),
    }));
  const deleteRow = (companyId: string, rowId: string) => {
    void run(async () => {
      deleteMonthRow(session, companyId, rowId);
      setCopyResults((current) => {
        const next = { ...current };
        delete next[companyId];
        return next;
      });
    });
  };
  const addCompany = () => {
    setName("");
    setError("");
    setManagerOpen(true);
  };
  const createCompany = (companyName: string): Company => ({
    id: crypto.randomUUID(),
    name: companyName,
    revision: 0,
    rows: [emptyRow()],
    withholdingAmount: 0,
    invoiced: false,
    paid: false,
    visible: true,
  });
  async function copyManager(companies: Company[]) {
    const p = copyPreviousVisibility(session, companies);
    refresh();
    try {
      return await p;
    } finally {
      refresh();
    }
  }
  let valid = true;
  try {
    prepareMonth(d, session.year, session.month);
  } catch {
    valid = false;
  }
  async function copyCompany(id: string) {
    await run(async () => {
      const result = await copyPreviousMonth(session, id);
      const period = `${result.year}年${result.month}月`;
      setCopyResults((current) => ({
        ...current,
        [id]: result.count
          ? `${period}から${result.count}件コピーしました。内容を確認して保存してください。`
          : `${period}にコピーできる報酬明細がありません。`,
      }));
    });
  }
  async function change(y: number, m: number, choice?: string) {
    await run(async () => {
      const result = await session.switchTo(y, m, choice);
      if (result === "changed" || result === "confirm") setManagerOpen(false);
      if (result === "changed") setCopyResults({});
      if (result === "confirm") setPending({ year: y, month: m });
      else if (result !== "busy") setPending(null);
    });
  }
  const cancelSwitch = () => {
    if (!session.busy && !session.navigating) {
      session.cancelSwitch();
      setPending(null);
    }
  };
  const formKeys = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229 &&
      (e.target as HTMLElement).tagName !== "BUTTON"
    )
      e.preventDefault();
  };
  function saveCompany() {
    if (!name.trim() || name.length > 80) {
      setError("会社名を入力してください。");
      return;
    }
    if (companyDialog?.id)
      update(companyDialog.id, (c) => ({ ...c, name: name.trim() }));
    setCompanyDialog(null);
  }
  return (
    <div id="app">
      <AppHeader
        view="monthly"
        year={session.year}
        onAnnual={() => void annual()}
        disabled={busy || !ready}
      />
      <main className="mm-main workspace">
        <div className="page-toolbar">
          <div className="page-title">
            <h1>月次入力</h1>
            <PeriodControl
              year={session.year}
              month={session.month}
              yearText={year}
              onYearText={setYear}
              disabled={busy || !ready}
              onYear={(y) => void change(y, session.month)}
              onStep={(step) => {
                const p = session.adjacent(step);
                void change(p.year, p.month);
              }}
            />
          </div>
          <div className="toolbar-actions">
            <button
              className="secondary-button manage"
              disabled={busy || !ready}
              onClick={addCompany}
            >
              <Icon name="company" />
              会社の表示・追加
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mm-error">
            {error}
          </p>
        )}
        {!ready && (
          <button disabled={busy} onClick={() => void load()}>
            {busy ? "読み込み中…" : "再読み込み"}
          </button>
        )}
        <fieldset disabled={busy || !ready} className="mm-workspace">
          {ready &&
            !d.companies.some((c) =>
              isCompanyVisible(c, session.year, session.month),
            ) && (
              <div className="mm-empty">
                この月に表示する会社はありません。「会社の表示・追加」から選んでください。
              </div>
            )}
          {d.companies
            .filter((c) => isCompanyVisible(c, session.year, session.month))
            .map((c) => {
              const totals = companyTotals(c.rows),
                status = c.paid
                  ? "入金済み"
                  : c.invoiced
                    ? "請求済み"
                    : "未請求";
              const copyBlocked = copyBlockReason(
                c,
                session.year,
                session.month,
              );
              const invalidAmount =
                Boolean(totals.invalidDiscount) ||
                c.rows.some(
                  (r) =>
                    r.rewardType === "hourly" &&
                    r.hours &&
                    r.rate &&
                    r.amount === null,
                );
              return (
                <section
                  key={c.id}
                  aria-label={c.name}
                  className={`mm-company company-card ${c.paid ? "is-paid" : c.invoiced ? "is-invoiced" : "is-unbilled"}`}
                >
                  <div className="mm-company-head company-heading">
                    <span className="company-initial" aria-hidden="true">
                      {c.name.slice(0, 1)}
                    </span>
                    <h2>{c.name}</h2>
                    <button
                      className="edit-company icon-button"
                      title="会社名を編集"
                      aria-label={`${c.name}の会社名を編集`}
                      onClick={() => {
                        setName(c.name);
                        setError("");
                        setCompanyDialog({ id: c.id });
                      }}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <span
                      className={`status-badge ${c.paid ? "paid" : c.invoiced ? "invoiced" : "draft"}`}
                    >
                      {
                        summary.rows.find(
                          (row: { id: string }) => row.id === c.id,
                        )?.status
                      }
                    </span>
                    <div className="company-controls">
                      <div className="mm-check-options">
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`${c.name}の請求済`}
                            checked={c.invoiced}
                            disabled={c.paid && c.invoiced}
                            onChange={(e) =>
                              update(c.id, (c) =>
                                changeChecks(c, "invoiced", e.target.checked),
                              )
                            }
                          />
                          請求済
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`${c.name}の入金済`}
                            checked={c.paid}
                            disabled={!c.invoiced && !c.paid}
                            onChange={(e) =>
                              update(c.id, (c) =>
                                changeChecks(c, "paid", e.target.checked),
                              )
                            }
                          />
                          入金済
                        </label>
                      </div>
                      <CompanyAmounts
                        summary={summary.rows.find(
                          (row: { id: string }) => row.id === c.id,
                        )!}
                        withholdingInput={
                          <AmountInput
                            label={`${c.name}の源泉徴収額`}
                            disabled={c.invoiced || c.paid}
                            value={String(c.withholdingAmount ?? "")}
                            onChange={(value) =>
                              update(c.id, (c) => ({
                                ...c,
                                withholdingAmount: integer(value),
                              }))
                            }
                          />
                        }
                      />
                    </div>
                  </div>
                  <div
                    className="mm-table-scroll detail-scroll"
                    tabIndex={0}
                    aria-label={`${c.name}の明細横スクロール`}
                  >
                    <table
                      className="mm-table detail-table"
                      aria-label={`${c.name}の報酬明細`}
                    >
                      <colgroup>
                        {[
                          "no",
                          "description",
                          "type",
                          "hours",
                          "rate",
                          "tax",
                          "amount",
                          "discount",
                          "discount-rate",
                          "withheld",
                          "delete",
                        ].map((key) => (
                          <col key={key} className={`col-${key}`} />
                        ))}
                      </colgroup>
                      <thead>
                        <tr>
                          {[
                            "No.",
                            "業務内容",
                            "報酬タイプ",
                            "時間（h）",
                            "単価（円）",
                            "税込／税抜",
                            "金額（円）",
                            "値引き",
                            "値引き率（%）",
                            "源泉あり",
                            "削除",
                          ].map((t) => (
                            <th key={t} scope="col">
                              {t}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {c.rows.map((r, i) => (
                          <tr key={r.id} className="mm-row">
                            <td className="mm-row-number row-number">
                              {i + 1}
                            </td>
                            <td>
                              <input
                                type="text"
                                aria-label={`${c.name}の${i + 1}行目の業務内容`}
                                placeholder={
                                  c.invoiced ? undefined : "例：取材・原稿作成"
                                }
                                maxLength={160}
                                disabled={c.invoiced}
                                value={r.description}
                                onChange={(e) =>
                                  updateRow(c.id, r.id, {
                                    description: e.target.value,
                                  })
                                }
                              />
                            </td>
                            <td>
                              <select
                                aria-label={`${c.name}の${i + 1}行目の報酬タイプ`}
                                disabled={c.invoiced}
                                value={r.rewardType}
                                onChange={(e) =>
                                  updateRow(c.id, r.id, {
                                    rewardType: e.target
                                      .value as Row["rewardType"],
                                  })
                                }
                              >
                                <option value="hourly">時給</option>
                                <option value="per_item">案件単価</option>
                                <option value="travel">交通費</option>
                                <option value="expense">立替経費</option>
                                <option value="adjustment">調整</option>
                              </select>
                            </td>
                            {r.rewardType === "hourly" ? (
                              <>
                                <td>
                                  <DecimalInput
                                    label={`${c.name}の${i + 1}行目の時間`}
                                    value={r.hours}
                                    placeholder="例：1.5"
                                    disabled={c.invoiced}
                                    onChange={(hours) =>
                                      updateRow(c.id, r.id, { hours })
                                    }
                                  />
                                </td>
                                <td>
                                  <DecimalInput
                                    label={`${c.name}の${i + 1}行目の単価（円）`}
                                    value={r.rate}
                                    placeholder="例：3000"
                                    disabled={c.invoiced}
                                    onChange={(rate) =>
                                      updateRow(c.id, r.id, { rate })
                                    }
                                  />
                                </td>
                              </>
                            ) : (
                              <>
                                <td
                                  className="mm-unused"
                                  aria-label={`${r.rewardType === "adjustment" ? "調整" : r.rewardType === "expense" ? "立替経費" : r.rewardType === "travel" ? "交通費" : "案件単価"}では時間を使用しません`}
                                >
                                  —
                                </td>
                                <td
                                  className="mm-unused"
                                  aria-label={`${r.rewardType === "adjustment" ? "調整" : r.rewardType === "expense" ? "立替経費" : r.rewardType === "travel" ? "交通費" : "案件単価"}では単価を使用しません`}
                                >
                                  —
                                </td>
                              </>
                            )}
                            <td>
                              {r.rewardType === "adjustment" ? (
                                <span className="mm-unused">対象外</span>
                              ) : (
                                <select
                                  aria-label={`${c.name}の${i + 1}行目の税込／税抜`}
                                  disabled={c.invoiced}
                                  value={r.priceMode}
                                  onChange={(e) =>
                                    updateRow(c.id, r.id, {
                                      priceMode: e.target.value,
                                    })
                                  }
                                >
                                  <option value="exclusive">税抜</option>
                                  <option value="inclusive">税込</option>
                                </select>
                              )}
                            </td>
                            <td>
                              {r.rewardType === "hourly" &&
                              invalidAmount &&
                              r.amount === null &&
                              r.hours &&
                              r.rate ? (
                                <span className="mm-error" role="alert">
                                  入力を確認
                                </span>
                              ) : (
                                <AmountInput
                                  label={`${c.name}の${i + 1}行目の${r.rewardType === "adjustment" ? "調整" : r.rewardType === "expense" ? "立替経費" : r.rewardType === "travel" ? "交通費" : "報酬額"}（円）`}
                                  disabled={c.invoiced}
                                  signed={r.rewardType === "adjustment"}
                                  readOnly={r.rewardType === "hourly"}
                                  value={String(r.amount ?? "")}
                                  onChange={(value) =>
                                    updateRow(c.id, r.id, {
                                      amount: integer(value),
                                    })
                                  }
                                />
                              )}
                            </td>
                            {isNonFeeType(r.rewardType) ? (
                              <td colSpan={2} className="mm-unused">
                                対象外
                              </td>
                            ) : (
                              <>
                                <td>
                                  <select
                                    aria-label={`${c.name}の${i + 1}行目の値引き`}
                                    disabled={c.invoiced}
                                    value={r.discountEnabled ? "apply" : "none"}
                                    onChange={(e) =>
                                      updateRow(c.id, r.id, {
                                        discountEnabled:
                                          e.target.value === "apply",
                                      })
                                    }
                                  >
                                    <option value="none">なし</option>
                                    <option value="apply">あり</option>
                                  </select>
                                </td>
                                <td>
                                  <DecimalInput
                                    label={`${c.name}の${i + 1}行目の値引き率（%）`}
                                    value={
                                      r.discountEnabled ? r.discountRate : "-"
                                    }
                                    placeholder="例：2"
                                    disabled={c.invoiced || !r.discountEnabled}
                                    accept={acceptDiscountRate}
                                    onChange={(discountRate) =>
                                      updateRow(c.id, r.id, { discountRate })
                                    }
                                  />
                                </td>
                              </>
                            )}
                            <td
                              className={
                                isNonFeeType(r.rewardType)
                                  ? "mm-unused"
                                  : "mm-withholding-cell"
                              }
                            >
                              {isNonFeeType(r.rewardType) ? (
                                "対象外"
                              ) : (
                                <input
                                  type="checkbox"
                                  aria-label={`${c.name}の${i + 1}行目の源泉徴収あり`}
                                  checked={r.withholdingEnabled}
                                  disabled={c.invoiced}
                                  onChange={(e) =>
                                    updateRow(c.id, r.id, {
                                      withholdingEnabled: e.target.checked,
                                    })
                                  }
                                />
                              )}
                            </td>
                            <td className="mm-delete-cell">
                              <DeleteRowButton
                                companyName={c.name}
                                index={i}
                                disabled={busy || c.invoiced || c.paid}
                                onDelete={() => deleteRow(c.id, r.id)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!c.rows.length && (
                    <p className="mm-empty">この月の明細はまだありません</p>
                  )}
                  <PreviousMonthAction
                    rowCount={c.rows.length}
                    companyId={c.id}
                    companyName={c.name}
                    blocked={copyBlocked}
                    busy={busy}
                    message={copyResults[c.id] || ""}
                    onCopy={() => void copyCompany(c.id)}
                  />
                  {!c.invoiced && (
                    <button
                      className="mm-add-row add-row"
                      aria-label={`${c.name}の報酬明細を追加`}
                      onClick={() =>
                        update(c.id, (c) => ({
                          ...c,
                          rows: [...c.rows, emptyRow()],
                        }))
                      }
                    >
                      ＋ 報酬明細を追加
                    </button>
                  )}
                  {!validChecks(c.invoiced, c.paid) && (
                    <p role="alert" className="mm-lock-note">
                      以前の保存内容が「未請求・入金済」です。実際の状態を確認し、入金済を外すか請求済を付けて訂正してください。
                    </p>
                  )}
                  {c.invoiced && (
                    <p className="mm-lock-note">
                      編集する場合は外部の請求状態を確認し、入金済→請求済の順にチェックを外してください。
                    </p>
                  )}
                </section>
              );
            })}
          {ready && (
            <MonthlySummary
              data={summary}
              year={session.year}
              month={session.month}
            />
          )}
        </fieldset>
        <p className="workspace-note">
          税込／税抜の入力を保持し、まず税込へ換算してから対象報酬を同率ごとに合算して値引きします。交通費・立替経費は対象外。値引き額の円未満は切り捨てます。値引き中の税抜合計・消費税は値引前の内訳です。税率は10%。報酬額・交通費・立替経費は入力額の合計です。消費税は会社・月ごとに税込／税抜別に合算後、1円未満を切り捨てます。時間は小数入力（1.5＝1時間30分）。時給の報酬額は自動計算・1円未満切り上げ。案件単価・交通費・立替経費は金額を直接入力します。調整は符号付き金額を小計へ加減し、税・値引き・源泉の計算対象外です。
        </p>
        <footer className="mm-footer">
          保存先：この端末。バックアップ・復元の実装までは架空データで検証してください。
        </footer>
      </main>
      <SaveBar
        year={session.year}
        month={session.month}
        dirty={session.dirty}
        ready={ready}
        busy={busy}
        valid={valid}
        invoice={summary.total.invoice}
        onSave={() => void run(() => session.save())}
      />
      {managerOpen && (
        <Modal
          title="会社の表示・追加"
          onCancel={() => {
            if (!busy) setManagerOpen(false);
          }}
        >
          <CompanyManager
            companies={d.companies}
            year={session.year}
            month={session.month}
            busy={busy}
            createCompany={createCompany}
            onCopy={copyManager}
            onCancel={() => setManagerOpen(false)}
            onApply={(companies) => {
              edit({ companies });
              setManagerOpen(false);
            }}
          />
        </Modal>
      )}
      {companyDialog && (
        <Modal
          title={companyDialog.id ? "会社名を編集" : "会社を追加"}
          onCancel={() => {
            if (!busy) setCompanyDialog(null);
          }}
        >
          <form onKeyDown={formKeys} onSubmit={(e) => e.preventDefault()}>
            <label className="mm-field">
              会社名
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="mm-dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setCompanyDialog(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={busy}
                className="mm-primary"
                onClick={saveCompany}
              >
                {companyDialog.id ? "反映する" : "追加"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {pendingAnnual && (
        <Modal
          title="変更を保存しますか？"
          onCancel={() => {
            if (!busy) setPendingAnnual(false);
          }}
        >
          <p>
            {session.year}年{session.month}
            月の全社分の変更が未保存です。年間集計へ移動します。
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="mm-dialog-actions">
            <button disabled={busy} onClick={() => setPendingAnnual(false)}>
              移動を中止
            </button>
            <button disabled={busy} onClick={() => void annual("discard")}>
              破棄して移動
            </button>
            <button
              disabled={busy || !valid}
              className="mm-primary"
              onClick={() => void annual("save")}
            >
              保存して移動
            </button>
          </div>
        </Modal>
      )}
      {pending && (
        <Modal title="変更を保存しますか？" onCancel={cancelSwitch}>
          <p>
            {session.year}年{session.month}月の全社分の変更が未保存です。
            {pending.year}年{pending.month}月へ切り替えます。
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="mm-dialog-actions">
            <button disabled={busy} onClick={cancelSwitch}>
              切替を中止
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change(pending.year, pending.month, "discard")
              }
            >
              破棄して切替
            </button>
            <button
              disabled={busy || !valid}
              className="mm-primary"
              onClick={() => void change(pending.year, pending.month, "save")}
            >
              保存して切替
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
