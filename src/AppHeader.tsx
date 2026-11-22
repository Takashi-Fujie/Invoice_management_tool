import React from "react";
import { Icon } from "./Icon";
import { pageUrl } from "./page-navigation.mjs";
export function AppHeader({
  view,
  year,
  month = 1,
  onAnnual,
  onBackup,
  disabled = false,
}: {
  view: "monthly" | "annual" | "backup";
  year: number;
  month?: number;
  onAnnual?: () => void;
  onBackup?: () => void;
  disabled?: boolean;
}) {
  const linkProps = (target: string) => ({
    href: disabled ? undefined : pageUrl(target, year, month),
    "aria-disabled": disabled || undefined,
  });
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="company" size={23} />
        </span>
        <strong>請求管理ツール</strong>
      </div>
      <nav aria-label="画面切替">
        {view === "monthly" ? (
          <button className="active" aria-current="page">
            <Icon name="month" size={14} />
            月次入力
          </button>
        ) : (
          <a {...linkProps("monthly")}>
            <Icon name="month" size={14} />
            月次入力
          </a>
        )}
        {view === "monthly" ? (
          <button disabled={disabled} onClick={onAnnual}>
            <Icon name="annual" size={14} />
            年間集計
          </button>
        ) : view === "annual" ? (
          <button className="active" aria-current="page">
            <Icon name="annual" size={14} />
            年間集計
          </button>
        ) : (
          <a {...linkProps("annual")}>
            <Icon name="annual" size={14} />
            年間集計
          </a>
        )}
        {view === "backup" ? (
          <button className="active" aria-current="page" disabled={disabled}>
            バックアップ・復元
          </button>
        ) : view === "monthly" ? (
          <button disabled={disabled} onClick={onBackup}>
            バックアップ・復元
          </button>
        ) : (
          <a {...linkProps("backup")}>バックアップ・復元</a>
        )}
      </nav>
      <div className="header-end">
        <a
          className="repository-link"
          href="https://github.com/Takashi-Fujie/Invoice_management_tool"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
