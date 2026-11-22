import { randomUUID } from "node:crypto";
import { mkdirSync, chmodSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { captureBackup, restoreBackup, verifyBackup } from "./backup.mjs";
import { readPrivateJSON, savePrivateJSON } from "./private-json.mjs";
import { BackupHistory } from "./backup-history.mjs";
import { backupFileName, MAX_BACKUP_BYTES } from "../src/backup-file-name.mjs";

const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
export function registerBackupRoutes(app, { db, path }) {
  const directory =
    path === ":memory:" ? null : join(dirname(path), "backup-state");
  // 以前の復元世代も読み、変更前の画面からの保存を再起動後も拒否する。
  const legacyDirectory =
    path === ":memory:" ? null : join(dirname(path), "google-backup");
  const previews = new Map(),
    exports = new Map();
  const history = new BackupHistory(directory);
  let recordWarning = "",
    busy = false,
    generation = null;
  try {
    const saved =
      readPrivateJSON(directory, "database-generation.json") ||
      readPrivateJSON(legacyDirectory, "database-generation.json");
    if (saved)
      generation =
        typeof saved.generation === "string" &&
        /^[a-f0-9-]{36}$/.test(saved.generation)
          ? saved.generation
          : randomUUID();
  } catch {
    generation = randomUUID();
    recordWarning =
      "復元操作の記録を読み取れません。月次画面を再読み込みしてください。";
  }
  const fingerprint = () =>
    captureBackup(db, { now: new Date(0), id: "fingerprint" }).manifest
      .checksum;
  async function exclusive(action) {
    if (busy)
      throw fail(
        "バックアップ・復元の処理中です。完了してから操作してください。",
        409,
      );
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }
  app.addHook("onRequest", async (req, reply) => {
    if (
      req.method === "PUT" &&
      req.url.startsWith("/api/month/") &&
      generation &&
      req.headers["x-invoice-database-generation"] !== generation
    )
      return reply.code(409).send({
        message:
          "復元操作の後のため、画面を再読み込みしてから入力してください。",
      });
    if (generation) reply.header("X-Invoice-Database-Generation", generation);
  });
  app.get("/api/backup/status", async () => ({
    mode: "file",
    lastBackup: history.records[0] || null,
    backups: history.records,
    recordWarning: [history.warning, recordWarning].filter(Boolean).join(" "),
  }));
  app.post("/api/backup/export", async (_req, reply) =>
    exclusive(async () => {
      const snapshot = verifyBackup(captureBackup(db));
      const body = JSON.stringify(snapshot);
      if (Buffer.byteLength(body) > MAX_BACKUP_BYTES - 32)
        throw fail(
          "バックアップのサイズが20MiBを超えています。データを切り捨てず処理を中止しました。",
        );
      const now = Date.now();
      for (const [key, job] of exports)
        if (job.expires < now) exports.delete(key);
      if (exports.size >= 20) exports.delete(exports.keys().next().value);
      exports.set(snapshot.manifest.backupId, {
        manifest: snapshot.manifest,
        expires: now + 30 * 60000,
      });
      reply.header(
        "X-Invoice-Backup-File",

        encodeURIComponent(
          backupFileName(
            snapshot.manifest.createdAt,
            snapshot.manifest.backupId,
          ),
        ),
      );
      return snapshot;
    }),
  );
  app.post("/api/backup/record", async (req) =>
    exclusive(async () => {
      const { backupId, fileName, location, method } = req.body || {};
      const existing = history.records.find((record) => record.id === backupId);
      if (existing) {
        if (
          existing.fileName !== fileName ||
          existing.location !== location ||
          existing.method !== method
        )
          throw fail("保存済みの記録と異なる内容は再利用できません。", 409);
        return { lastBackup: history.records[0], backups: history.records };
      }
      const job = exports.get(backupId);
      if (!job || job.expires < Date.now())
        throw fail(
          "バックアップの記録期限が切れました。保存したファイルは保持されています。",
          409,
        );
      if (
        typeof fileName !== "string" ||
        fileName.length > 255 ||
        !fileName.endsWith(".json") ||
        /[\/\\\x00-\x1f\x7f]/.test(fileName) ||
        typeof location !== "string" ||
        !location.trim() ||
        location.length > 1024 ||
        /[\x00-\x1f\x7f]/.test(location) ||
        !["directory", "file", "download"].includes(method)
      )
        throw fail("保存場所の記録内容を確認してください。");
      const record = {
        createdAt: job.manifest.createdAt,
        savedAt: new Date().toISOString(),
        counts: job.manifest.counts,
        fileName,
        location: location.trim(),
        method,
      };
      history.append(backupId, record);
      exports.delete(backupId);
      return { lastBackup: history.records[0], backups: history.records };
    }),
  );
  app.post(
    "/api/backup/preview",
    { bodyLimit: MAX_BACKUP_BYTES },
    async (req) =>
      exclusive(async () => {
        if (req.body?.previousToken) previews.delete(req.body.previousToken);
        let snapshot;
        try {
          snapshot = verifyBackup(req.body?.backup);
        } catch {
          throw fail(
            "バックアップJSONの内容・バージョン・整合性を確認できません。現在のDBは変更していません。",
          );
        }
        for (const [key, preview] of previews)
          if (preview.expires < Date.now()) previews.delete(key);
        if (previews.size >= 5) previews.delete(previews.keys().next().value);
        const previewToken = randomUUID();
        previews.set(previewToken, {
          snapshot,
          fingerprint: fingerprint(),
          expires: Date.now() + 10 * 60000,
        });
        return {
          previewToken,
          createdAt: snapshot.manifest.createdAt,
          counts: snapshot.manifest.counts,
        };
      }),
  );
  app.post("/api/backup/restore", async (req) =>
    exclusive(async () => {
      const preview = previews.get(req.body?.previewToken);
      if (!preview || preview.expires < Date.now())
        throw fail(
          "復元内容の確認が切れました。ファイルを選んで確認し直してください。",
          409,
        );
      if (fingerprint() !== preview.fingerprint)
        throw fail(
          "確認後に現在のデータが変更されました。復元内容を確認し直してください。",
          409,
        );
      if (path !== ":memory:") {
        const local = join(dirname(path), "restore-backups");
        mkdirSync(local, { recursive: true, mode: 0o700 });
        if (lstatSync(local).isSymbolicLink())
          throw fail(
            "復元前の退避先を確認してください。現在のDBは変更していません。",
          );
        chmodSync(local, 0o700);
        const backupPath = join(
          local,
          "before-restore-" + Date.now() + "-" + randomUUID() + ".sqlite",
        );
        db.prepare("VACUUM INTO ?").run(backupPath);
        chmodSync(backupPath, 0o600);
        const copy = new DatabaseSync(backupPath, { readOnly: true });
        try {
          if (
            captureBackup(copy, { now: new Date(0), id: "fingerprint" })
              .manifest.checksum !== preview.fingerprint
          )
            throw fail(
              "復元前の退避が一致しません。現在のDBは変更していません。",
              409,
            );
        } finally {
          copy.close();
        }
      }
      const nextGeneration = randomUUID();
      savePrivateJSON(directory, "database-generation.json", {
        generation: nextGeneration,
      });
      generation = nextGeneration;
      restoreBackup(db, preview.snapshot, {
        expectedChecksum: preview.fingerprint,
      });
      previews.clear();
      return {
        restored: true,
        createdAt: preview.snapshot.manifest.createdAt,
        counts: preview.snapshot.manifest.counts,
      };
    }),
  );
}
