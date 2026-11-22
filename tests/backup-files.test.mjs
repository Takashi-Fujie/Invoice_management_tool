import { test, expect, vi } from "vitest";
import { prepareBackupSave } from "../src/backup-files.mjs";
import { backupFileName } from "../src/backup-file-name.mjs";

test("S20-T05：日本時間の日時と識別子でJSON名を作る", () => {
  expect(backupFileName("2026-12-31T15:00:01Z", "12345678-abcd")).toBe(
    "請求管理ツール_バックアップ_20270101000001_12345678.json",
  );
});
function folder({
  exists = false,
  writeFailure = false,
  corrupt = false,
} = {}) {
  let content = "";
  const close = vi.fn(),
    abort = vi.fn();
  const file = {
    createWritable: vi.fn(async () => ({
      write: async (text) => {
        if (writeFailure) throw Error("private-path");
        content = text;
      },
      close,
      abort,
    })),
    getFile: async () => ({
      text: async () => (corrupt ? "damaged" : content),
    }),
  };
  const directory = {
    name: "請求バックアップ",
    getFileHandle: vi.fn(async (_name, options) => {
      if (!options?.create && !exists)
        throw new DOMException("missing", "NotFoundError");
      return file;
    }),
  };
  const env = { showDirectoryPicker: vi.fn(async () => directory) };
  return { env, directory, file, close, abort };
}

test("S20-T08/T18：フォルダを選び、書込みと読戻し後にフォルダ名・ファイル名を返す", async () => {
  const { env, directory, close } = folder();
  const promise = prepareBackupSave(env);
  expect(env.showDirectoryPicker).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "readwrite" }),
  );
  const write = await promise;
  const snapshot = {
    manifest: { id: "fictional" },
    body: { text: "改行\n絵文字🍀" },
  };
  const result = await write(snapshot, "backup.json");
  expect(close).toHaveBeenCalledOnce();
  expect(result).toEqual({
    method: "directory",
    fileName: "backup.json",
    location: "請求バックアップ/backup.json",
  });
  expect(directory.getFileHandle).toHaveBeenLastCalledWith("backup.json", {
    create: true,
  });
});

test("S20-T05/T06/T19：既存ファイル・書込み失敗・読戻し不一致を成功扱いにしない", async () => {
  for (const controls of [
    { exists: true },
    { writeFailure: true },
    { corrupt: true },
  ]) {
    const { env, file } = folder(controls);
    const write = await prepareBackupSave(env);
    await expect(write({}, "backup.json")).rejects.toThrow();
    if (controls.exists) expect(file.createWritable).not.toHaveBeenCalled();
  }
});

test("S20-T18：未対応環境はダウンロード開始とし、保存フォルダと同期完了を断定しない", async () => {
  const anchor = { click: vi.fn(), remove: vi.fn() };
  const env = {
    Blob,
    document: { createElement: () => anchor, body: { append: vi.fn() } },
    URL: { createObjectURL: () => "blob:fictional", revokeObjectURL: vi.fn() },
    setTimeout: (fn) => fn(),
  };
  const write = await prepareBackupSave(env);
  expect(await write({}, "backup.json")).toEqual({
    method: "download",
    fileName: "backup.json",
    location: "ブラウザのダウンロード先（フォルダ未確認）",
  });
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.download).toBe("backup.json");
});
