import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AnnualSession } from "./annual-session.mjs";
import { AnnualTable, StatusIcon } from "./AnnualSummary";
import type { AnnualData } from "./AnnualSummary";
import "./style.css";
import "./annual.css";
import { AppHeader } from "./AppHeader";
import { PeriodControl } from "./PeriodControl";
import { detailMoney } from "./presentation.mjs";
const session = new AnnualSession(
  {
    load: async (year: number) => {
      const response = await fetch(`/api/annual/${year}`);
      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ message: "読取に失敗しました。" }));
        throw Error(error.message);
      }
      return response.json();
    },
  },
  window,
);
function AnnualApp() {
  const [, redraw] = useState(0),
    [year, setYear] = useState(String(session.year)),
    [expanded, setExpanded] = useState(new Set<string>()),
    [inputError, setInputError] = useState("");
  useEffect(() => {
    session.start(() => {
      redraw((n) => n + 1);
      setYear(String(session.year));
    });
    void session.open();
    return () => session.stop();
  }, []);
  useEffect(() => setExpanded(new Set()), [session.year]);
  const change = (value: number) => {
    try {
      const result = session.changeYear(value);
      setInputError("");
      void result;
    } catch (error) {
      setInputError((error as Error).message);
      setYear(String(session.year));
    }
  };
  return (
    <div id="app" className="annual-app">
      <AppHeader view="annual" year={session.year} />
      <main className="mm-main workspace">
        <div className="page-toolbar is-annual">
          <div className="page-title">
            <h1>年間集計</h1>
            <PeriodControl
              year={session.year}
              yearText={year}
              onYearText={setYear}
              onYear={change}
              onStep={(step) => change(session.year + step)}
              disabled={session.busy}
            />
          </div>
          <div className="toolbar-actions">
            {session.data && (
              <div className="annual-total">
                <span>年間請求額 · 全社合計</span>
                <strong>
                  {detailMoney(
                    "invoice",
                    (session.data as AnnualData).total.total.invoice,
                    true,
                  )}
                </strong>
              </div>
            )}
          </div>
        </div>
        <div className="annual-caption">
          <h2>会社別の請求額</h2>
          <div className="annual-legend">
            {["請求前", "請求済", "入金済み"].map((status) => (
              <span key={status}>
                <StatusIcon status={status} />
                {status === "請求済"
                  ? "請求済・未入金"
                  : status === "請求前"
                    ? "未請求"
                    : status}
              </span>
            ))}
          </div>
        </div>
        {inputError && (
          <p role="alert" className="mm-error">
            {inputError}
          </p>
        )}
        {session.busy && <p role="status">読み込み中…</p>}
        {session.error && (
          <div role="alert" className="mm-error">
            {session.error}
            <button onClick={() => void session.open()}>再読み込み</button>
          </div>
        )}
        {session.data && (
          <AnnualTable
            key={session.year}
            data={session.data as AnnualData}
            expanded={expanded}
            onToggle={(id) =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        )}
        <p className="workspace-note">
          列見出しをクリックして昇順／降順を切り替えます。会社名・全社合計の ▶
          で金額内訳を表示 ·
          会社別の月別金額をクリックすると、その月の入力ページへ移動します。
        </p>
      </main>
      <footer className="annual-footer">
        <span>保存済みの月次入力から集計しています</span>
        <span>単位：円</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<AnnualApp />);
