import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BackupSession } from "../src/backup-session.mjs";
import { BackupView } from "../src/BackupPanel.tsx";

test("S20-T06/T10：未保存時は実行せず、通信失敗後も保存先と再試行IDを保持する", async () => {
  const calls = [];
  let fail = true;
  const model = new BackupSession(
    async (action, body) => {
      calls.push({ action, body });
      if (fail) throw Error("通信に失敗しました。");
      return { title: "完了", counts: { clients: 1 } };
    },
    () => "retry-id",
  );
  model.setDestination(
    "https://docs.google.com/spreadsheets/d/test-spreadsheet/edit",
  );
  await model.backup(true);
  expect(calls).toHaveLength(0);
  expect(model.error).toContain("保存");
  await model.backup(false);
  expect(model.busy).toBe(false);
  expect(model.error).toContain("通信");
  const first = calls[0].body.requestId;
  fail = false;
  await model.backup(false);
  expect(calls[1].body.requestId).toBe(first);
  expect(model.result.title).toBe("完了");
  expect(model.destination).toContain("test-spreadsheet");
});
test("S20-T10/T11：一覧・内容確認・実行を分け、保存先や選択の変更で古い確認を破棄する", async () => {
  const calls = [];
  const model = new BackupSession(async (action, body) => {
    calls.push({ action, body });
    if (action === "list")
      return {
        backups: [
          { sheetId: 1, title: "保存済み", createdAt: "2026-11-03T03:30:00Z" },
        ],
      };
    if (action === "preview")
      return {
        previewToken: "preview",
        createdAt: "2026-11-03T03:30:00Z",
        counts: { clients: 1 },
      };
    return { restored: true };
  });
  model.setDestination("test-spreadsheet");
  await model.list();
  model.selectSheet("1");
  await model.check(false);
  expect(model.preview.previewToken).toBe("preview");
  expect(calls.some((c) => c.action === "restore")).toBe(false);
  model.setDestination("other-spreadsheet");
  expect(model.preview).toBeNull();
  expect(model.backups).toHaveLength(0);
  await model.restore(false);
  expect(calls.some((c) => c.action === "restore")).toBe(false);
});
test("S20-T10：未保存・処理中は書込みを止め、完了・失敗・初期設定を読める表示にする", () => {
  const state = new BackupSession(async () => ({}));
  state.connected = true;
  state.configured = true;
  state.destination = "test-spreadsheet";
  const html = renderToStaticMarkup(
    React.createElement(BackupView, {
      state,
      dirty: true,
      onDestination() {},
      onSheet() {},
      onConfigure() {},
      onConnect() {},
      onBackup() {},
      onList() {},
      onCheck() {},
      onRestore() {},
      onClose() {},
    }),
  );
  expect(html).toContain("先に月次入力を保存");
  expect(html).toContain("保存済みの全会社・全年月");
  expect(html).toContain("今すぐバックアップ");
  expect(html).toMatch(/disabled=""[^>]*>今すぐバックアップ/);
});

test("S20-T05/T06：同名時の拒否後は新しい処理で実行し直せる", async () => {
  let attempt = 0;
  const ids = [];
  const model = new BackupSession(
    async (_action, body) => {
      ids.push(body.requestId);
      if (attempt++ === 0)
        throw Object.assign(Error("同じ日時"), { statusCode: 409 });
      return {};
    },
    () => `id-${attempt}`,
  );
  model.setDestination("test-spreadsheet");
  await model.backup(false);
  await model.backup(false);
  expect(ids[0]).not.toBe(ids[1]);
});

test("S20-T13/T15：保存先はGoogle選択だけとし、再接続後に以前の先と確認を残さない", async () => {
  const state = new BackupSession(async () => ({
    configured: true,
    connected: true,
    destination: "https://docs.google.com/spreadsheets/d/new-spreadsheet/edit",
    selectedFile: { name: "選択した架空バックアップ用" },
    connectionId: "new-connection",
  }));
  state.configured = true;
  state.connected = true;
  state.setDestination("old-spreadsheet");
  state.preview = { previewToken: "old-preview" };
  state.result = { title: "old-result" };
  await state.open();
  expect(state.destination).toContain("new-spreadsheet");
  expect(state.preview).toBeNull();
  expect(state.result).toBeNull();
  const html = renderToStaticMarkup(
    React.createElement(BackupView, {
      state,
      dirty: false,
      onDestination() {},
      onSheet() {},
      onConfigure() {},
      onConnect() {},
      onBackup() {},
      onList() {},
      onCheck() {},
      onRestore() {},
      onClose() {},
    }),
  );
  expect(html).not.toContain('type="url"');
  expect(html).toContain("Googleで保存先を選び直す");
  expect(html).toContain("選択した架空バックアップ用");
  expect(html).not.toContain("OAuthクライアントを作成してください");
});
