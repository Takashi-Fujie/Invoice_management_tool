import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  brand,
  createMock,
  details,
  money,
  newRow,
} from "./redesign-2026-model.mjs";
import { acceptAmount } from "../../src/month.mjs";
import {
  acceptDecimal,
  acceptDiscountRate,
  isNonFeeType,
} from "../../src/reward.mjs";
import {
  isCompanyVisible,
  visibilityBlockReason,
} from "../../src/company-visibility.mjs";
import { CompanyManager } from "../../src/CompanyManager";
import { MonthlySummary } from "../../src/MonthlySummary";
import "./redesign-2026.css";

const paths = {
  month: "M4 4h16v16H4zM4 9h16M9 9v11",
  annual: "M5 20V12m7 8V4m7 16V8",
  left: "m14 6-6 6 6 6",
  right: "m10 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  save: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  bin: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  moon: "M20 15.5A9 9 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z",
  sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 1.4 1.4m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  edit: "m15 4 5 5-10 10-6 1 1-6ZM13 6l5 5",
  lock: "M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4",
  company: "M4 21V4h11v17M15 10h5v11M8 8h3M8 12h3M8 16h3M2 21h20",
};
const displayedAmount = (key, value) =>
  key === "discount" && value > 0 ? -value : value;
const detailMoney = (key, value, currency = false) => {
  const amount = displayedAmount(key, value);
  if (!currency || amount == null) return money(amount);
  return `${amount < 0 ? "-" : ""}¥${money(Math.abs(amount))}`;
};
const displayedSummaryRow = (row) => ({
  ...row,
  discount: displayedAmount("discount", row.discount),
});
function Icon({ name, size = 17 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.plus} />
    </svg>
  );
}
function Amount({
  value,
  onChange,
  label,
  disabled = false,
  readOnly = false,
  signed = false,
}) {
  const [editing, setEditing] = useState(false),
    [raw, setRaw] = useState("");
  const composing = useRef(false);
  const apply = (text) => {
    const accepted = acceptAmount(
      editing ? raw : String(value ?? ""),
      text,
      signed,
    );
    setRaw(accepted);
    if (accepted === text)
      onChange?.(text === "" || text === "-" ? null : Number(text));
  };
  return (
    <input
      className="amount"
      type="text"
      inputMode={signed ? "text" : "numeric"}
      aria-label={label}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={readOnly || disabled ? "" : "0"}
      value={editing && !readOnly ? raw : value === null ? "" : money(value)}
      onFocus={() => {
        setRaw(String(value ?? ""));
        setEditing(true);
      }}
      onBlur={() => setEditing(false)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        apply(e.currentTarget.value);
      }}
      onChange={(e) => {
        if (composing.current) setRaw(e.target.value);
        else apply(e.target.value);
      }}
    />
  );
}
function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

function App() {
  const [s] = useState(createMock),
    [, redraw] = useState(0),
    [dark, setDark] = useState(false),
    [manager, setManager] = useState(false),
    [pending, setPending] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [rename, setRename] = useState(null),
    [renameText, setRenameText] = useState(""),
    [expanded, setExpanded] = useState(new Set()),
    [sort, setSort] = useState({ column: "name", ascending: true });
  const refresh = () => redraw((n) => n + 1);
  const run = (fn) => {
    try {
      setError("");
      fn();
      refresh();
    } catch (e) {
      setError(e.message);
      refresh();
    }
  };
  const save = () =>
    run(() => {
      s.save();
      setNotice("このモック内に保存しました。");
    });
  const move = (year, month, view, choice) =>
    run(() => {
      if (s.move(year, month, view, choice) === "confirm") {
        setPending({ year, month, view });
        return;
      }
      setPending(null);
      setExpanded(new Set());
      setSort({ column: "name", ascending: true });
      setNotice("");
    });
  const adjacent = (step) => {
    const date = new Date(2000, 0);
    date.setFullYear(s.year, s.month - 1 + step, 1);
    move(date.getFullYear(), date.getMonth() + 1, "monthly");
  };
  const update = (cid, rid, patch) =>
    run(() => {
      s.updateRow(cid, rid, patch);
      setNotice("");
    });
  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const goMonth = (month) => move(s.year, month, "monthly");
  const total = s.summary.total;
  const annual = s.view === "annual" ? s.annual() : null;
  const annualRows = annual?.rows
    .filter((c) => c.total.invoice !== 0)
    .sort((a, b) => {
      const value = (c) =>
        sort.column === "name"
          ? c.name
          : sort.column === "total"
            ? c.total.invoice
            : c.months[sort.column - 1]?.invoice;
      const aValue = value(a),
        bValue = value(b);
      if (aValue == null) return bValue == null ? 0 : 1;
      if (bValue == null) return -1;
      const result =
        typeof aValue === "string"
          ? aValue.localeCompare(bValue, "ja")
          : aValue - bValue;
      return (
        (sort.ascending ? result : -result) ||
        a.name.localeCompare(b.name, "ja")
      );
    });
  const sortHeading = (column, label) => (
    <th
      scope="col"
      key={column}
      aria-sort={
        sort.column === column
          ? sort.ascending
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      <button
        onClick={() =>
          setSort((old) => ({
            column,
            ascending:
              old.column === column ? !old.ascending : column === "name",
          }))
        }
        aria-label={`${label}で並び替え`}
      >
        {label}
        <span aria-hidden="true">
          {sort.column === column ? (sort.ascending ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
  const annualCell = (record, month, key = "invoice", status = false) =>
    !record ? (
      <span className="muted">—</span>
    ) : (
      <button
        className="month-link"
        onClick={() => goMonth(month)}
        aria-label={`${s.year}年${month}月の月次入力を開く`}
      >
        {detailMoney(key, record[key])}
        {status && (
          <span
            className={`status-icon ${record.status === "入金済み" ? "paid" : record.status === "請求済" ? "invoiced" : ""}`}
            role="img"
            aria-label={record.status}
          >
            {record.status === "入金済み"
              ? "✓"
              : record.status === "請求済"
                ? "▤"
                : "○"}
          </span>
        )}
      </button>
    );
  const periodControl = (
    <div
      className="period-control heading-period-control"
      aria-label="対象期間"
    >
      <button
        className="icon-button"
        aria-label={s.view === "monthly" ? "前月へ" : "前年へ"}
        onClick={() =>
          s.view === "monthly"
            ? adjacent(-1)
            : move(s.year - 1, s.month, "annual")
        }
        disabled={s.year === 1 && (s.month === 1 || s.view === "annual")}
      >
        <Icon name="left" />
      </button>
      <label className="period-year">
        <span className="sr-only">対象年度</span>
        <input
          key={`year-${s.year}`}
          aria-label="対象年度"
          inputMode="numeric"
          maxLength={4}
          defaultValue={s.year}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing)
              e.currentTarget.blur();
          }}
          onBlur={(e) => {
            move(Number(e.currentTarget.value), s.month, s.view);
            e.currentTarget.value = String(s.year);
          }}
        />
        <span className="year-unit" aria-hidden="true">
          年
        </span>
      </label>
      <div className="year-picker" title="年度を選択">
        <Icon name="down" size={15} />
        <select
          aria-label="年度を選択"
          value={s.year}
          onChange={(e) => move(Number(e.target.value), s.month, s.view)}
        >
          {Array.from(
            {
              length: Math.min(9999, s.year + 5) - Math.max(1, s.year - 5) + 1,
            },
            (_, i) => {
              const year = Math.max(1, s.year - 5) + i;
              return (
                <option key={year} value={year}>
                  {year}年
                </option>
              );
            },
          )}
        </select>
      </div>
      {s.view === "monthly" && (
        <span className="period-month" aria-label={`対象月 ${s.month}月`}>
          {s.month}月
        </span>
      )}
      <button
        className="icon-button"
        aria-label={s.view === "monthly" ? "翌月へ" : "翌年へ"}
        onClick={() =>
          s.view === "monthly"
            ? adjacent(1)
            : move(s.year + 1, s.month, "annual")
        }
        disabled={s.year === 9999 && (s.month === 12 || s.view === "annual")}
      >
        <Icon name="right" />
      </button>
    </div>
  );
  return (
    <div id="design-app" data-theme={dark ? "dark" : "light"}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="22" height="24" viewBox="0 0 22 24" fill="none">
              <path
                d="M3 2h12l4 4v16l-4-2-4 2-4-2-4 2V2Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M7 8h8M7 12h5M7 16h8"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </span>
          <strong>{brand}</strong>
        </div>
        <nav aria-label="画面切替">
          <button
            className={s.view === "monthly" ? "active" : ""}
            aria-current={s.view === "monthly" ? "page" : undefined}
            onClick={() => move(s.year, s.month, "monthly")}
          >
            <Icon name="month" />
            月次入力
          </button>
          <button
            className={s.view === "annual" ? "active" : ""}
            aria-current={s.view === "annual" ? "page" : undefined}
            onClick={() => move(s.year, s.month, "annual")}
          >
            <Icon name="annual" />
            年間集計
          </button>
        </nav>
        <div className="header-end">
          <span className="mock-tag">
            デザインモック <span>／ 架空データ</span>
          </span>
          <button
            className="icon-button theme-switch"
            title="モックの配色を切り替える"
            aria-label={dark ? "明色のモックを見る" : "暗色のモックを見る"}
            onClick={() => setDark((v) => !v)}
          >
            <Icon name={dark ? "sun" : "moon"} />
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className={`page-toolbar${annual ? " is-annual" : ""}`}>
          <div className="page-title">
            <h1>{s.view === "monthly" ? "月次入力" : "年間集計"}</h1>
            {periodControl}
          </div>
          <div className="toolbar-actions">
            {annual && (
              <div className="annual-total">
                <span>年間請求額 · 全社合計</span>
                <strong>¥{money(annual.total.total.invoice)}</strong>
              </div>
            )}

            {s.view === "monthly" && (
              <button
                className="secondary-button manage"
                onClick={() => setManager(true)}
              >
                <Icon name="company" />
                会社の表示・追加
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {s.view === "monthly" ? (
          <>
            <div className="company-list">
              {s.visible().map((c, ci) => {
                const t = s.summary.rows.find((x) => x.id === c.id),
                  locked = c.invoiced || c.paid;
                return (
                  <section
                    className={`company-card ${c.paid ? "is-paid" : c.invoiced ? "is-invoiced" : ""}`}
                    key={c.id}
                    aria-label={c.name}
                  >
                    <div className="company-heading">
                      <span className="company-initial" aria-hidden="true">
                        {c.name.slice(0, 1)}
                      </span>
                      <h2>{c.name.replace("（架空）", "")}</h2>
                      <button
                        className="edit-company icon-button"
                        title="会社名を編集"
                        aria-label={`${c.name}の会社名を編集`}
                        onClick={() => {
                          setRename(c.id);
                          setRenameText(c.name);
                        }}
                      >
                        <Icon name="edit" size={13} />
                      </button>
                      <span
                        className={`status-badge ${c.paid ? "paid" : c.invoiced ? "invoiced" : "draft"}`}
                      >
                        {c.paid ? (
                          <Icon name="check" size={12} />
                        ) : c.invoiced ? (
                          <Icon name="lock" size={11} />
                        ) : (
                          <span className="badge-dot" />
                        )}
                        {t.status}
                      </span>
                      <div className="company-controls">
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`${c.name}の請求済`}
                            checked={c.invoiced}
                            disabled={c.paid}
                            onChange={(e) =>
                              run(() =>
                                s.setCheck(c.id, "invoiced", e.target.checked),
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
                            disabled={!c.invoiced}
                            onChange={(e) =>
                              run(() =>
                                s.setCheck(c.id, "paid", e.target.checked),
                              )
                            }
                          />
                          入金済
                        </label>

                        <div
                          className="company-amounts"
                          aria-label={`${c.name}の請求額と内訳`}
                        >
                          <div className="company-amounts-main">
                            <span className="company-invoice">
                              <small>請求額</small>
                              <b>¥{money(t.invoice)}</b>
                            </span>
                            <label className="withholding">
                              {details[0][1]}
                              <Amount
                                label={`${c.name}の源泉徴収額`}
                                value={c.withholdingAmount}
                                disabled={locked}
                                onChange={(value) =>
                                  run(() => {
                                    c.withholdingAmount = value;
                                  })
                                }
                              />
                            </label>
                          </div>
                          <div className="company-breakdown">
                            {details
                              .filter(([key]) => key !== "withheld")
                              .map(([key, label]) => (
                                <span
                                  key={key}
                                  className={`breakdown-item ${key}`}
                                  data-amount-key={key}
                                >
                                  <span>{label}</span>
                                  <strong>
                                    {detailMoney(key, t[key], true)}
                                  </strong>
                                </span>
                              ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    {c.rows.length === 0 && (
                      <div className="previous-month">
                        <button
                          className="secondary-button"
                          disabled={locked}
                          onClick={() =>
                            run(() => {
                              const previous =
                                s.month === 1
                                  ? { year: s.year - 1, month: 12 }
                                  : { year: s.year, month: s.month - 1 };
                              const source = s
                                .getMonth(previous.year, previous.month)
                                .companies.find((x) => x.id === c.id);
                              const rows =
                                source?.rows.filter(
                                  (r) => !isNonFeeType(r.rewardType),
                                ) ?? [];
                              if (!rows.length) {
                                setNotice(
                                  "前月にコピーできる報酬明細がありません。",
                                );
                                return;
                              }
                              c.rows = structuredClone(rows).map((r) => ({
                                ...r,
                                id: crypto.randomUUID(),
                              }));
                            })
                          }
                        >
                          前月からコピー
                        </button>
                        <span>報酬明細のみを引き継ぎます。</span>
                      </div>
                    )}
                    <div
                      className="detail-scroll"
                      tabIndex={0}
                      aria-label={`${c.name}の明細横スクロール`}
                    >
                      <table
                        className="detail-table"
                        aria-label={`${c.name}の明細`}
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
                          ].map((x) => (
                            <col className={`col-${x}`} key={x} />
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
                              "",
                            ].map((label, i) => (
                              <th scope="col" key={i}>
                                {label || <span className="sr-only">削除</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {c.rows.map((r, i) => {
                            const label = (name) =>
                              `${c.name}の${i + 1}行目の${name}`;
                            const nonfee = isNonFeeType(r.rewardType);
                            return (
                              <tr
                                key={r.id}
                                className={nonfee ? "non-fee" : ""}
                              >
                                <td className="row-number">
                                  {String(i + 1).padStart(2, "0")}
                                </td>
                                <td>
                                  <input
                                    aria-label={label("業務内容")}
                                    maxLength={160}
                                    value={r.description}
                                    disabled={locked}
                                    placeholder="業務内容を入力"
                                    onChange={(e) =>
                                      update(c.id, r.id, {
                                        description: e.target.value,
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <select
                                    aria-label={label("報酬タイプ")}
                                    value={r.rewardType}
                                    disabled={locked}
                                    onChange={(e) =>
                                      update(c.id, r.id, {
                                        rewardType: e.target.value,
                                      })
                                    }
                                  >
                                    {[
                                      ["per_item", "案件単価"],
                                      ["hourly", "時給"],
                                      ["travel", "交通費"],
                                      ["expense", "立替経費"],
                                      ["adjustment", "調整"],
                                    ].map(([value, label]) => (
                                      <option value={value} key={value}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  {r.rewardType === "hourly" ? (
                                    <input
                                      className="amount"
                                      aria-label={label("時間")}
                                      inputMode="decimal"
                                      value={r.hours}
                                      disabled={locked}
                                      onChange={(e) =>
                                        update(c.id, r.id, {
                                          hours: acceptDecimal(
                                            r.hours,
                                            e.target.value,
                                          ),
                                        })
                                      }
                                    />
                                  ) : (
                                    <span className="unused">—</span>
                                  )}
                                </td>
                                <td>
                                  {r.rewardType === "hourly" ? (
                                    <input
                                      className="amount"
                                      aria-label={label("単価")}
                                      inputMode="decimal"
                                      value={r.rate}
                                      disabled={locked}
                                      onChange={(e) =>
                                        update(c.id, r.id, {
                                          rate: acceptDecimal(
                                            r.rate,
                                            e.target.value,
                                          ),
                                        })
                                      }
                                    />
                                  ) : (
                                    <span className="unused">—</span>
                                  )}
                                </td>
                                <td>
                                  {r.rewardType === "adjustment" ? (
                                    <span className="unused">—</span>
                                  ) : (
                                    <select
                                      aria-label={label("税込／税抜")}
                                      disabled={locked}
                                      value={r.priceMode}
                                      onChange={(e) =>
                                        update(c.id, r.id, {
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
                                  <Amount
                                    label={label("金額")}
                                    value={r.amount}
                                    disabled={locked}
                                    signed={r.rewardType === "adjustment"}
                                    readOnly={r.rewardType === "hourly"}
                                    onChange={(value) =>
                                      update(c.id, r.id, { amount: value })
                                    }
                                  />
                                </td>
                                <td>
                                  {nonfee ? (
                                    <span className="unused">—</span>
                                  ) : (
                                    <select
                                      aria-label={label("値引き")}
                                      disabled={locked}
                                      value={String(r.discountEnabled)}
                                      onChange={(e) =>
                                        update(c.id, r.id, {
                                          discountEnabled:
                                            e.target.value === "true",
                                        })
                                      }
                                    >
                                      <option value="false">なし</option>
                                      <option value="true">あり</option>
                                    </select>
                                  )}
                                </td>
                                <td>
                                  {nonfee || !r.discountEnabled ? (
                                    <span className="unused">—</span>
                                  ) : (
                                    <input
                                      className="amount"
                                      aria-label={label("値引き率")}
                                      inputMode="decimal"
                                      disabled={locked}
                                      value={r.discountRate}
                                      onChange={(e) =>
                                        update(c.id, r.id, {
                                          discountRate: acceptDiscountRate(
                                            r.discountRate,
                                            e.target.value,
                                          ),
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td className="center">
                                  {!nonfee && (
                                    <input
                                      type="checkbox"
                                      aria-label={label("源泉あり")}
                                      checked={r.withholdingEnabled}
                                      disabled={locked}
                                      onChange={(e) =>
                                        update(c.id, r.id, {
                                          withholdingEnabled: e.target.checked,
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td className="center">
                                  <button
                                    className="icon-button delete-row"
                                    disabled={locked}
                                    aria-label={`${c.name}の${i + 1}行目を削除`}
                                    onClick={() =>
                                      run(() => s.removeRow(c.id, r.id))
                                    }
                                  >
                                    <Icon name="bin" size={13} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="company-footer">
                      {locked ? (
                        <span className="locked-note">
                          <Icon name="lock" size={10} />
                          請求済のため明細は編集できません
                        </span>
                      ) : (
                        <button
                          className="add-row"
                          aria-label={`${c.name}の明細を追加`}
                          onClick={() => run(() => c.rows.push(newRow()))}
                        >
                          <Icon name="plus" size={12} />
                          明細を追加
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
            {s.visible().length === 0 && (
              <div className="empty-state">
                <Icon name="company" size={34} />
                <h2>この月に表示する会社はありません</h2>
                <p>「会社の表示・追加」から、入力する会社を選んでください。</p>
                <button
                  className="primary-button"
                  onClick={() => setManager(true)}
                >
                  会社を選ぶ
                </button>
              </div>
            )}
            <MonthlySummary
              data={{
                rows: s.summary.rows.map(displayedSummaryRow),
                total: displayedSummaryRow(s.summary.total),
              }}
              year={s.year}
              month={s.month}
            />
            <p className="workspace-note">
              税込・税抜の入力を保持し、税と値引きは会社・月ごとに計算します。源泉徴収額は手入力です。
            </p>
          </>
        ) : (
          <>
            <div className="annual-caption">
              <h2>会社別の請求額</h2>
              <span>
                ○ 請求前 <span className="blue">▤ 請求済・未入金</span>{" "}
                <span className="green">✓ 入金済み</span>
              </span>
            </div>
            <div
              className="annual-scroll"
              tabIndex={0}
              aria-label="年間集計の横スクロール"
            >
              <table
                className="annual-table"
                aria-label={`${s.year}年の会社別年間集計`}
              >
                <thead>
                  <tr>
                    {sortHeading("name", "会社名")}
                    {Array.from({ length: 12 }, (_, i) =>
                      sortHeading(i + 1, `${i + 1}月`),
                    )}
                    {sortHeading("total", "年合計")}
                  </tr>
                </thead>
                <tbody>
                  {annualRows.map((c) => (
                    <React.Fragment key={c.id}>
                      <tr>
                        <th scope="row">
                          <button
                            className="expand-button"
                            aria-expanded={expanded.has(c.id)}
                            aria-label={`${c.name}の内訳を${expanded.has(c.id) ? "閉じる" : "開く"}`}
                            onClick={() => toggle(c.id)}
                          >
                            <span
                              className={expanded.has(c.id) ? "rotated" : ""}
                            >
                              <Icon name="right" size={13} />
                            </span>
                            {c.name.replace("（架空）", "")}
                          </button>
                        </th>
                        {c.months.map((r, i) => (
                          <td key={i}>
                            {annualCell(r, i + 1, "invoice", true)}
                          </td>
                        ))}
                        <td className="year-total">{money(c.total.invoice)}</td>
                      </tr>
                      {expanded.has(c.id) &&
                        details.map(([key, label]) => (
                          <tr key={key} className={`annual-detail ${key}`}>
                            <th scope="row">{label}</th>
                            {c.months.map((r, i) => (
                              <td key={i}>{annualCell(r, i + 1, key)}</td>
                            ))}
                            <td className="year-total">
                              {detailMoney(key, c.total[key])}
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">
                      <button
                        className="expand-button"
                        aria-expanded={expanded.has("total")}
                        aria-label={`全社合計の内訳を${expanded.has("total") ? "閉じる" : "開く"}`}
                        onClick={() => toggle("total")}
                      >
                        <span
                          className={expanded.has("total") ? "rotated" : ""}
                        >
                          <Icon name="right" size={13} />
                        </span>
                        全社合計
                      </button>
                    </th>
                    {annual.total.months.map((r, i) => (
                      <td key={i}>{money(r.invoice)}</td>
                    ))}
                    <td className="year-total">
                      {money(annual.total.total.invoice)}
                    </td>
                  </tr>
                  {expanded.has("total") &&
                    details.map(([key, label]) => (
                      <tr key={key} className={`annual-detail ${key}`}>
                        <th scope="row">{label}</th>
                        {annual.total.months.map((r, i) => (
                          <td key={i}>{detailMoney(key, r[key])}</td>
                        ))}
                        <td className="year-total">
                          {detailMoney(key, annual.total.total[key])}
                        </td>
                      </tr>
                    ))}
                </tfoot>
              </table>
            </div>
            <p className="workspace-note">
              金額からその月の入力画面を開けます。矢印で内訳を表示し、列見出しで並べ替えできます。
            </p>
          </>
        )}
      </main>
      {s.view === "monthly" ? (
        <footer className={`save-dock ${s.dirty ? "is-dirty" : ""}`}>
          <div className="save-state" role="status" aria-atomic="true">
            <span className="save-state-icon" aria-hidden="true">
              {s.dirty ? "!" : <Icon name="check" size={18} />}
            </span>
            <div>
              <div className="save-state-heading">
                <strong>
                  {s.dirty
                    ? "未保存の変更があります"
                    : "すべての変更を保存済み"}
                </strong>
                <span>
                  {s.year}年{s.month}月 · 全社分
                </span>
              </div>
              <p>
                {s.dirty
                  ? s.valid
                    ? "変更を反映するには「変更を保存」を押してください。"
                    : "業務内容・金額・時間・単価・条件を確認してください。"
                  : notice || "このモック内だけに保存されます。"}
              </p>
            </div>
          </div>
          <div className="dock-total">
            <small>当月請求額 · 全社合計</small>
            <strong>¥{money(total.invoice)}</strong>
          </div>
          <button
            className="save-button"
            disabled={!s.dirty || !s.valid}
            onClick={save}
          >
            <Icon name="save" size={18} />
            変更を保存
          </button>
        </footer>
      ) : (
        <footer className="annual-footer">
          <span>デザインモック · 架空データ</span>
          <span>保存済みの月次入力から集計しています</span>
        </footer>
      )}
      {manager && (
        <Dialog title="会社の表示・追加" onClose={() => setManager(false)}>
          <CompanyManager
            companies={s.draft.companies}
            year={s.year}
            month={s.month}
            busy={false}
            createCompany={(name) => ({
              id: crypto.randomUUID(),
              name,
              visible: true,
              revision: 0,
              rows: [newRow()],
              withholdingAmount: 0,
              invoiced: false,
              paid: false,
            })}
            onApply={(companies) => {
              s.draft.companies = companies;
              setManager(false);
              refresh();
            }}
            onCancel={() => setManager(false)}
            onCopy={async (companies) => {
              const p =
                s.month === 1
                  ? { year: s.year - 1, month: 12 }
                  : { year: s.year, month: s.month - 1 };
              const previous = s.getMonth(p.year, p.month);
              const copied = companies.map((c) => ({
                ...c,
                visible:
                  !!visibilityBlockReason(c, s.year, s.month) ||
                  !!previous.companies.find(
                    (candidate) =>
                      candidate.id === c.id &&
                      isCompanyVisible(candidate, p.year, p.month),
                  ),
              }));
              return {
                ...p,
                companies: copied,
                count: copied.filter((c) => c.visible).length,
              };
            }}
          />
        </Dialog>
      )}
      {pending && (
        <Dialog title="変更を保存しますか？" onClose={() => setPending(null)}>
          <p className="dialog-description">
            {s.year}年{s.month}月の全社分に、未保存の変更があります。
          </p>
          <p className="dialog-description">
            {pending.view === "annual"
              ? "年間集計を開く"
              : `${pending.year}年${pending.month}月に切り替える`}
            前に、変更の扱いを選んでください。
          </p>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button onClick={() => setPending(null)}>中止</button>
            <button
              onClick={() =>
                move(pending.year, pending.month, pending.view, "discard")
              }
            >
              破棄して移動
            </button>
            <button
              className="primary-button"
              disabled={!s.valid}
              onClick={() =>
                move(pending.year, pending.month, pending.view, "save")
              }
            >
              保存して移動
            </button>
          </div>
        </Dialog>
      )}
      {rename && (
        <Dialog title="会社名を編集" onClose={() => setRename(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!renameText.trim()) return;
              run(() => {
                s.draft.companies.find((c) => c.id === rename).name =
                  renameText.trim();
                setRename(null);
              });
            }}
          >
            <label className="rename-label">
              会社名
              <input
                maxLength={80}
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setRename(null)}>
                キャンセル
              </button>
              <button className="primary-button">反映する</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
