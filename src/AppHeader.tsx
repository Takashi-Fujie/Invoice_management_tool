import React from "react";
import { Icon } from "./Icon";
export function AppHeader({
  view,
  year,
  onAnnual,
  disabled = false,
}: {
  view: "monthly" | "annual";
  year: number;
  onAnnual?: () => void;
  disabled?: boolean;
}) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="company" size={23} />
        </span>
        <strong>請求管理ツール</strong>
      </div>
      <nav aria-label="画面切替">
        {view === "annual" ? (
          <a href={`/?year=${year}&month=1`}>
            <Icon name="month" size={14} />
            月次入力
          </a>
        ) : (
          <button className="active" aria-current="page">
            <Icon name="month" size={14} />
            月次入力
          </button>
        )}
        {view === "monthly" ? (
          <button disabled={disabled} onClick={onAnnual}>
            <Icon name="annual" size={14} />
            年間集計
          </button>
        ) : (
          <a
            className="active"
            aria-current="page"
            href={`/annual.html?year=${year}`}
          >
            <Icon name="annual" size={14} />
            年間集計
          </a>
        )}
      </nav>
    </header>
  );
}
