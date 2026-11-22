import { test, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { version } from "../package.json";
import { BackupPage } from "../src/BackupPanel.tsx";
import { BackupSession } from "../src/backup-session.mjs";

test("S35-T08：バックアップ画面の下端に現在のツールバージョンを1回表示する", () => {
  const html = renderToStaticMarkup(
    React.createElement(BackupPage, {
      year: 2026,
      month: 11,
      model: new BackupSession(async () => ({})),
    }),
  );
  expect(html).toMatch(/<footer\b[^>]*>.*バージョン /);
  expect(html.match(/バージョン /g)).toHaveLength(1);
  expect(html).toContain(`バージョン ${version}`);
  expect(html.indexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
});

test("S35-T08：定義を更新すると表示も追従し、既存のフッター案内を保持する", async () => {
  vi.resetModules();
  vi.doMock("../package.json", () => ({ version: "9.8.7" }));
  try {
    const { AppFooter } = await import("../src/AppFooter.tsx");
    const html = renderToStaticMarkup(
      React.createElement(
        AppFooter,
        null,
        React.createElement(
          "span",
          null,
          "保存済みの月次入力から集計しています",
        ),
        React.createElement("span", null, "単位：円"),
      ),
    );
    expect(html).toContain("バージョン 9.8.7");
    expect(html).toContain("保存済みの月次入力から集計しています");
    expect(html).toContain("単位：円");
  } finally {
    vi.doUnmock("../package.json");
    vi.resetModules();
  }
});
