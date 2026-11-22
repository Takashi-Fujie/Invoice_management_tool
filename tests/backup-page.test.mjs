import { test, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppHeader } from "../src/AppHeader.tsx";
import { BackupPage } from "../src/BackupPanel.tsx";
import { BackupSession } from "../src/backup-session.mjs";
import { openMonthlyPage, backupPeriod } from "../src/page-navigation.mjs";

const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));
test("S20-T20：専用ページに最新記録・保存・復元を表示し、モーダルや開閉ボタンを使わない", () => {
  const model = new BackupSession(async () => ({}));
  model.lastBackup = {
    savedAt: "2026-11-22T03:00:00Z",
    createdAt: "2026-11-22T02:59:00Z",
    method: "directory",
    location: "請求バックアップ/backup.json",
    counts: { clients: 2 },
  };
  const html = render(BackupPage, { year: 2026, month: 11, model });
  expect(html).toContain("<h1>バックアップ・復元</h1>");
  expect(html).toContain("バックアップリスト");
  expect(html).toContain("請求バックアップ/backup.json");
  expect(html).toContain('class="backup-actions"');
  expect(html).toContain("バックアップファイルを保存");
  expect(html).toContain("復元");
  expect(html).not.toMatch(/<dialog|バックアップを閉じる/);
  expect(html).toContain("/?year=2026&amp;month=11");
  expect(html).toContain("/annual.html?year=2026");
});

test("S20-T10：月次・年間から専用画面へ対象年月を渡し、選択中の画面を示す", () => {
  const monthly = render(AppHeader, {
    view: "monthly",
    year: 2026,
    month: 11,
    onBackup: () => {},
  });
  expect(monthly).not.toContain("<dialog");
  const annual = render(AppHeader, { view: "annual", year: 2025 });
  expect(annual).toContain("/backup.html?year=2025&amp;month=1");
  const backup = render(AppHeader, { view: "backup", year: 2026, month: 11 });
  expect(backup).toMatch(/aria-current="page"[^>]*>バックアップ・復元/);
});

test("S20-T10：未保存の専用画面移動は確認し、中止・保存失敗で入力を保持する", async () => {
  const session = {
    year: 2026,
    month: 11,
    dirty: true,
    busy: false,
    navigating: false,
    draft: { amount: 100 },
    save: vi.fn(async () => {
      throw Error("保存失敗");
    }),
  };
  const navigate = vi.fn();
  expect(await openMonthlyPage(session, navigate, "backup")).toBe("confirm");
  expect(await openMonthlyPage(session, navigate, "backup", "cancel")).toBe(
    "cancelled",
  );
  expect(navigate).not.toHaveBeenCalled();
  await expect(
    openMonthlyPage(session, navigate, "backup", "save"),
  ).rejects.toThrow("保存失敗");
  expect(session.draft).toEqual({ amount: 100 });
  expect(navigate).not.toHaveBeenCalled();
  session.save = vi.fn(async () => {
    session.dirty = false;
  });
  await openMonthlyPage(session, navigate, "backup", "save");
  expect(session.save).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith("/backup.html?year=2026&month=11");
});

test("S20-T10/T21：破棄して移動でき、処理中の移動は拒否する", async () => {
  const session = {
    year: 2025,
    month: 12,
    dirty: true,
    busy: false,
    navigating: false,
    save: vi.fn(),
  };
  const navigate = vi.fn();
  expect(await openMonthlyPage(session, navigate, "backup", "discard")).toBe(
    "changed",
  );
  expect(navigate).toHaveBeenCalledWith("/backup.html?year=2025&month=12");
  expect(session.save).not.toHaveBeenCalled();
  session.busy = true;
  expect(await openMonthlyPage(session, navigate, "backup")).toBe("busy");
  expect(navigate).toHaveBeenCalledOnce();
});

test("S20-T10：URLの年月は正当性を確認し、不正・重複は端末当月に戻す", () => {
  const today = new Date(2026, 10, 22);
  expect(
    backupPeriod("http://127.0.0.1/backup.html?year=2025&month=12", today),
  ).toEqual({ year: 2025, month: 12 });
  for (const query of [
    "",
    "?year=0&month=13",
    "?year=2025&year=2026&month=12",
    "?year=<script>&month=1",
  ])
    expect(backupPeriod("http://127.0.0.1/backup.html" + query, today)).toEqual(
      { year: 2026, month: 11 },
    );
});

test("S20-T21：処理中は専用画面のナビ移動と保存・復元を止める", () => {
  const model = new BackupSession(async () => ({}));
  model.busy = true;
  const html = render(BackupPage, { year: 2026, month: 11, model });
  expect(html).toContain('aria-disabled="true"');
  expect(html).not.toContain('href="/?year=');
  expect(html).not.toContain('href="/annual.html');
  expect(html).toMatch(/disabled=""[^>]*>バックアップファイルを保存/);
});

test("S20-T23：保存・復元を上段、複数行の履歴リストを下段に配置する", () => {
  const model = new BackupSession(async () => ({}));
  model.backups = [
    {
      id: "new",
      createdAt: "2026-11-22T03:00:00Z",
      savedAt: "2026-11-22T03:01:00Z",
      counts: { clients: 2 },
      fileName: "new.json",
      location: "請求バックアップ/new.json",
      method: "directory",
    },
    {
      id: "old",
      createdAt: "2026-11-21T03:00:00Z",
      savedAt: "2026-11-21T03:01:00Z",
      counts: { clients: 1 },
      fileName: "old.json",
      location: "請求バックアップ/old.json",
      method: "download",
    },
  ];
  const html = render(BackupPage, { year: 2026, month: 11, model });
  const save = html.indexOf("<h2>バックアップ保存</h2>"),
    restore = html.indexOf("<h2>復元</h2>"),
    list = html.indexOf("<h2>バックアップリスト</h2>");
  expect(save).toBeGreaterThan(-1);
  expect(restore).toBeGreaterThan(save);
  expect(list).toBeGreaterThan(restore);
  expect(html).toContain('aria-label="バックアップリスト"');
  expect(html.indexOf("new.json")).toBeLessThan(html.indexOf("old.json"));
  expect(html).toContain("保存場所");
  expect(html).toContain("保存未確認");
});
