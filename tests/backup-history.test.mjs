import { test, expect } from "vitest";
import { createApp } from "../server/app.mjs";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const post = (app, action, payload = {}) =>
  app.inject({
    method: "POST",
    url: "/api/backup/" + action,
    headers,
    payload,
  });
const status = async (app) =>
  (await app.inject({ url: "/api/backup/status", headers })).json();
const legacy = {
  createdAt: "2026-11-20T03:00:00Z",
  savedAt: "2026-11-20T03:01:00Z",
  counts: {
    clients: 0,
    invoices: 0,
    billable_items: 0,
    invoice_lines: 0,
    client_month_visibility: 0,
  },
  fileName: "old.json",
  location: "以前のフォルダ/old.json",
  method: "directory",
};
async function record(app, fileName, method = "directory") {
  const backup = (await post(app, "export")).json();
  const payload = {
    backupId: backup.manifest.backupId,
    fileName,
    location:
      method === "download"
        ? "ブラウザのダウンロード先（フォルダ未確認）"
        : "請求バックアップ/" + fileName,
    method,
  };
  const response = await post(app, "record", payload);
  return { response, payload };
}
test("S20-T22：旧最新記録を引き継ぎ、複数の履歴を新しい順で再起動後も保持する", async () => {
  const directory = mkdtempSync(join(tmpdir(), "invoice-history-")),
    path = join(directory, "db.sqlite"),
    state = join(directory, "backup-state");
  mkdirSync(state);
  const original = JSON.stringify(legacy);
  writeFileSync(join(state, "latest.json"), original, { mode: 0o600 });
  let app = createApp({ path });
  try {
    expect((await status(app)).backups).toHaveLength(1);
    const first = await record(app, "first.json");
    expect(first.response.statusCode).toBe(200);
    const second = await record(app, "second.json", "download");
    expect(second.response.statusCode).toBe(200);
    expect((await status(app)).backups.map((r) => r.fileName)).toEqual([
      "second.json",
      "first.json",
      "old.json",
    ]);
    await app.close();
    app = createApp({ path });
    const current = await status(app);
    expect(current.backups.map((r) => r.fileName)).toEqual([
      "second.json",
      "first.json",
      "old.json",
    ]);
    expect(current.lastBackup).toEqual(current.backups[0]);
    expect(current.backups[0].method).toBe("download");
    expect(readFileSync(join(state, "latest.json"), "utf8")).toBe(original);
    const records = join(state, "records");
    expect(readdirSync(records)).toHaveLength(3);
    for (const name of readdirSync(records))
      expect(statSync(join(records, name)).mode & 0o077).toBe(0);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("S20-T22：準備だけ・不正な記録で履歴を増やさず、同じ保存結果の再送も重複しない", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    await post(app, "export");
    expect((await status(app)).backups).toEqual([]);
    const first = await record(app, "first.json");
    const again = await post(app, "record", first.payload);
    expect(again.statusCode).toBe(200);
    expect((await status(app)).backups).toHaveLength(1);
    expect(
      (await post(app, "record", { ...first.payload, fileName: "other.json" }))
        .statusCode,
    ).toBe(409);
    expect((await status(app)).backups).toHaveLength(1);
  } finally {
    await app.close();
  }
});
test("S20-T22：履歴1件が破損しても正常な履歴と新規保存を保ち、破損ファイルを消さない", async () => {
  const directory = mkdtempSync(join(tmpdir(), "invoice-history-damage-")),
    path = join(directory, "db.sqlite");
  let app = createApp({ path });
  try {
    await record(app, "first.json");
    await record(app, "second.json");
    await app.close();
    const records = join(directory, "backup-state", "records"),
      file = join(records, readdirSync(records)[0]);
    writeFileSync(file, "broken-record", { mode: 0o600 });
    app = createApp({ path });
    const current = await status(app);
    expect(current.backups).toHaveLength(1);
    expect(current.recordWarning).toContain("記録");
    expect((await record(app, "third.json")).response.statusCode).toBe(200);
    expect((await status(app)).backups).toHaveLength(2);
    expect(readFileSync(file, "utf8")).toBe("broken-record");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("S20-T22：履歴ファイルへの保存失敗でも前のリストを保持する", async () => {
  const directory = mkdtempSync(join(tmpdir(), "invoice-history-write-")),
    path = join(directory, "db.sqlite");
  const app = createApp({ path });
  try {
    await record(app, "first.json");
    const previous = await status(app);
    const records = join(directory, "backup-state", "records");
    renameSync(records, records + "-safe");
    writeFileSync(records, "write-denied", { mode: 0o600 });
    expect((await record(app, "failed.json")).response.statusCode).toBe(500);
    expect((await status(app)).backups).toEqual(previous.backups);
    expect(readdirSync(records + "-safe")).toHaveLength(1);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
