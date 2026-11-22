import { test, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BackupSession } from "../src/backup-session.mjs";
import { BackupView } from "../src/BackupPanel.tsx";
const snapshot = {
  manifest: {
    backupId: "id",
    createdAt: "2026-11-22T03:00:00Z",
    counts: { clients: 1 },
  },
  body: {},
};
const saved = {
  method: "directory",
  fileName: "backup.json",
  location: "請求バックアップ/backup.json",
};
function setup() {
  const calls = [];
  const request = vi.fn(async (action, body) => {
    calls.push({ action, body });
    if (action === "export") return { snapshot, fileName: "backup.json" };
    if (action === "record")
      return {
        lastBackup: {
          ...saved,
          createdAt: snapshot.manifest.createdAt,
          savedAt: "2026-11-22T03:01:00Z",
          counts: { clients: 1 },
        },
      };
    if (action === "preview")
      return {
        previewToken: "preview",
        createdAt: snapshot.manifest.createdAt,
        counts: { clients: 1 },
      };
    return { mode: "file", lastBackup: null };
  });
  const write = vi.fn(async () => saved);
  const prepare = vi.fn(async () => write);
  const model = new BackupSession(request, prepare);
  return { model, calls, request, prepare, write };
}
const file = (name = "backup.json", text = JSON.stringify(snapshot)) =>
  new File([text], name, { type: "application/json" });

test("S20-T06/T08/T10：未保存時は保存画面も開かず、操作直後に保存先を選び書込み後に記録する", async () => {
  const { model, calls, prepare, write } = setup();
  await model.backup(true);
  expect(prepare).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
  const work = model.backup(false);
  expect(prepare).toHaveBeenCalledTimes(1);
  await work;
  expect(write).toHaveBeenCalledWith(snapshot, "backup.json");
  expect(calls.map((c) => c.action)).toEqual(["export", "record"]);
  expect(model.lastBackup.location).toBe(saved.location);
  expect(model.result.method).toBe("directory");
});

test("S20-T06/T19：選択取消・書込み失敗で成功と履歴を残さず、再試行できる", async () => {
  const { model, prepare, write, calls } = setup();
  prepare.mockRejectedValueOnce(new DOMException("cancel", "AbortError"));
  await model.backup(false);
  expect(calls).toHaveLength(0);
  expect(model.result).toBeNull();
  expect(model.error).toBe("");
  write.mockRejectedValueOnce(Error("ファイルを保存できません。"));
  await model.backup(false);
  expect(calls.map((c) => c.action)).toEqual(["export"]);
  expect(model.lastBackup).toBeNull();
  expect(model.result).toBeNull();
  expect(model.error).toContain("保存");
  await model.backup(false);
  expect(model.lastBackup.location).toBe(saved.location);
});

test("S20-T10：処理中の二重保存・閉じる操作を止める状態を保つ", async () => {
  const { model, prepare, calls } = setup();
  let finish;
  prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const work = model.backup(false);
  expect(model.busy).toBe(true);
  await model.backup(false);
  expect(prepare).toHaveBeenCalledTimes(1);
  finish(async () => saved);
  await work;
  expect(calls.map((c) => c.action)).toEqual(["export", "record"]);
  expect(model.busy).toBe(false);
});

test("S20-T07/T11/T15：選択と確認と復元を分け、選択変更で古い確認を破棄する", async () => {
  const { model, calls } = setup();
  model.selectFile(file());
  await model.check(false);
  expect(model.preview.previewToken).toBe("preview");
  expect(calls.some((c) => c.action === "restore")).toBe(false);
  model.selectFile(file("other.json"));
  expect(model.preview).toBeNull();
  await model.restore(false);
  expect(calls.some((c) => c.action === "restore")).toBe(false);
  model.selectFile(file("broken.json", "壊れたJSON"));
  await model.check(false);
  expect(model.preview).toBeNull();
  expect(model.error).toContain("JSON");
});

test("S20-T07/T10：サイズ超過・未保存時の確認を送信前に拒否する", async () => {
  const { model, calls } = setup();
  model.selectFile({
    name: "huge.json",
    size: 20 * 1024 * 1024 + 1,
    text: vi.fn(),
  });
  await model.check(false);
  expect(model.error).toContain("20");
  expect(calls).toHaveLength(0);
  model.selectFile(file());
  await model.check(true);
  expect(calls).toHaveLength(0);
});

test("S20-T18/T19：最新日時・保存場所を読込み、記録失敗時は前回の履歴を保つ", async () => {
  const { model, request } = setup();
  request.mockResolvedValueOnce({
    mode: "file",
    lastBackup: {
      ...saved,
      createdAt: snapshot.manifest.createdAt,
      savedAt: "2026-11-22T03:01:00Z",
    },
  });
  await model.open();
  const previous = structuredClone(model.lastBackup);
  request.mockImplementationOnce(async () => ({
    snapshot,
    fileName: "backup.json",
  }));
  request.mockRejectedValueOnce(Error("記録失敗"));
  await model.backup(false);
  expect(model.lastBackup).toEqual(previous);
  expect(model.error).toContain("記録");
});

test("S20-T10/T13/T17/T18：Google設定欄を表示せず、最新日時・保存場所と同期確認の案内を表示する", () => {
  const { model } = setup();
  model.lastBackup = {
    ...saved,
    createdAt: snapshot.manifest.createdAt,
    savedAt: "2026-11-22T03:01:00Z",
    counts: { clients: 1 },
  };
  const html = renderToStaticMarkup(
    React.createElement(BackupView, { state: model, dirty: true }),
  );
  expect(html).toContain("先に月次入力を保存");
  expect(html).toContain("バックアップファイルを保存");
  expect(html).toContain("バックアップリスト");
  expect(html).toContain("請求バックアップ/backup.json");
  expect(html).toContain("2026/11/22");
  expect(html).not.toMatch(/設定JSON|Googleログイン|スプレッドシート/);
  expect(html).toContain("同期");
  expect(html).toMatch(/disabled=""[^>]*>バックアップファイルを保存/);
});

test("S20-T22：読み込んだ複数履歴を保持し、保存後は新しいリストをすぐ表示する", async () => {
  const { model, request } = setup();
  const old = {
    ...saved,
    createdAt: snapshot.manifest.createdAt,
    savedAt: "2026-11-21T03:00:00Z",
  };
  request.mockResolvedValueOnce({
    lastBackup: old,
    backups: [old, { ...old, fileName: "older.json" }],
  });
  await model.open();
  expect(model.backups).toHaveLength(2);
  request.mockResolvedValueOnce({ snapshot, fileName: "new.json" });
  request.mockResolvedValueOnce({
    lastBackup: { ...old, fileName: "new.json" },
    backups: [{ ...old, fileName: "new.json" }, ...model.backups],
  });
  await model.backup(false);
  expect(model.backups).toHaveLength(3);
  expect(model.backups[0].fileName).toBe("new.json");
});
