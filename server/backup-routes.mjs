import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { captureBackup, restoreBackup, verifyBackup } from "./backup.mjs";
import { GoogleSheetsBackup, spreadsheetId } from "./google-sheets.mjs";
import {
  GoogleConnection,
  readPrivateJSON,
  savePrivateJSON,
} from "./google-auth.mjs";

const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
export function registerBackupRoutes(
  app,
  { db, path, port, backupOptions = {} },
) {
  const directory =
    path === ":memory:" ? null : join(dirname(path), "google-backup");
  const auth = backupOptions.auth || new GoogleConnection({ directory, port });
  const google =
    backupOptions.google ||
    new GoogleSheetsBackup({ getAccessToken: (id) => auth.getAccessToken(id) });
  const previews = new Map(),
    jobs = new Map();
  let preferences = {},
    preferenceWarning = null,
    busy = false,
    generation = null;
  try {
    preferences = readPrivateJSON(directory, "preferences.json") || {};
  } catch {
    preferenceWarning =
      "保存先の設定を読み取れません。Googleで保存先を選び直してください。";
  }
  try {
    const saved = readPrivateJSON(directory, "database-generation.json");
    if (saved)
      generation =
        typeof saved.generation === "string" &&
        /^[a-f0-9-]{36}$/.test(saved.generation)
          ? saved.generation
          : randomUUID();
  } catch {
    generation = randomUUID();
    preferenceWarning =
      "復元操作の設定を読み取れません。月次画面を再読み込みしてから操作してください。";
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
  const context = (req, { destination = true } = {}) => {
    const selected = auth.selectedFile();
    if (!auth.status().connected || !selected)
      throw fail("Googleで保存先を選んでください。", 401);
    const key = auth.selectionKey();
    if (!key || req.body?.connectionId !== key)
      throw fail(
        "Googleの接続先が変わりました。画面を開き直して操作してください。",
        409,
      );
    if (destination && spreadsheetId(req.body?.destination) !== selected.id)
      throw fail("Googleで選択した保存先だけを操作できます。", 403);
    return { destination: selected.id, connectionId: key };
  };
  app.get("/api/backup/status", async () => {
    const state = auth.status(),
      selected = state.connected ? auth.selectedFile() : null;
    return {
      ...state,
      ...(preferenceWarning ? { preferenceWarning } : {}),
      connectionId: selected ? auth.selectionKey() : null,
      selectedFile: selected,
      destination: selected
        ? `https://docs.google.com/spreadsheets/d/${selected.id}/edit`
        : "",
      lastSuccess:
        selected &&
        preferences.connectionId === auth.selectionKey() &&
        preferences.destination === selected.id
          ? preferences.lastSuccess
          : null,
    };
  });
  app.post("/api/google/configure", async (req) =>
    exclusive(async () => {
      auth.configure(req.body);
      return auth.status();
    }),
  );
  app.post("/api/google/start", async (req) =>
    exclusive(() => auth.start(req.body?.returnTo)),
  );
  app.get("/api/google/callback", async (req, reply) => {
    const target = await exclusive(() => auth.finish(req.query));
    return reply.redirect(target);
  });
  app.post("/api/backup/run", async (req) =>
    exclusive(async () => {
      const { destination, connectionId } = context(req),
        requestId = req.body?.requestId;
      if (
        typeof requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)
      )
        throw fail("バックアップの実行情報を確認してください。");
      const expired = Date.now() - 30 * 60000;
      for (const [key, job] of jobs)
        if (job.started < expired) jobs.delete(key);
      if (jobs.size >= 20 && !jobs.has(requestId))
        throw fail(
          "処理回数が多すぎます。しばらく待ってから再実行してください。",
          429,
        );
      let job = jobs.get(requestId);
      if (
        job &&
        (job.destination !== destination || job.connectionId !== connectionId)
      )
        throw fail(
          "再試行では保存先を変更できません。新しいバックアップとして実行してください。",
          409,
        );
      if (!job) {
        job = {
          destination,
          connectionId,
          snapshot: captureBackup(db),
          started: Date.now(),
        };
        jobs.set(requestId, job);
      }
      const result = await google.upload(destination, job.snapshot);
      preferences = {
        destination,
        connectionId,
        lastSuccess: {
          title: result.title,
          createdAt: result.manifest.createdAt,
          counts: result.manifest.counts,
          url: result.url,
        },
      };
      savePrivateJSON(directory, "preferences.json", preferences);
      return {
        ...result,
        manifest: undefined,
        createdAt: result.manifest.createdAt,
        counts: result.manifest.counts,
      };
    }),
  );
  app.post("/api/backup/list", async (req) =>
    exclusive(async () => ({
      backups: await google.list(context(req).destination),
    })),
  );
  app.post("/api/backup/preview", async (req) =>
    exclusive(async () => {
      const selection = context(req);
      const snapshot = verifyBackup(
        await google.download(selection.destination, req.body?.sheetId),
      );
      for (const [key, preview] of previews)
        if (preview.expires < Date.now()) previews.delete(key);
      if (previews.size >= 5) previews.delete(previews.keys().next().value);
      const previewToken = randomUUID();
      previews.set(previewToken, {
        ...selection,
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
      const selection = context(req, { destination: false });
      const preview = previews.get(req.body?.previewToken);
      if (
        !preview ||
        preview.expires < Date.now() ||
        preview.connectionId !== selection.connectionId ||
        preview.destination !== selection.destination
      )
        throw fail(
          "復元内容の確認が切れました。バックアップを選んで確認し直してください。",
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
        const backupPath = join(
          local,
          `before-restore-${Date.now()}-${randomUUID()}.sqlite`,
        );
        db.prepare("VACUUM INTO ?").run(backupPath);
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
      jobs.clear();
      return {
        restored: true,
        createdAt: preview.snapshot.manifest.createdAt,
        counts: preview.snapshot.manifest.counts,
      };
    }),
  );
}
