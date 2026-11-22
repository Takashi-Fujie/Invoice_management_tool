import { test, expect } from "vitest";
import { createApp } from "../server/app.mjs";
import { verifyBackup, captureBackup } from "../server/backup.mjs";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const get = (app) => app.inject({ url: "/api/month/2026/11", headers });
const put = (app, payload) =>
  app.inject({ method: "PUT", url: "/api/month/2026/11", headers, payload });
const data = (name = "青葉制作（架空）") => ({
  companies: [
    {
      id: "a",
      name,
      revision: 0,
      rows: [],
      visible: true,
      invoiced: false,
      paid: false,
      withholdingAmount: 0,
    },
  ],
});
const folder = () => mkdtempSync(join(tmpdir(), "invoice-file-api-"));

test("S20-T01/T05/T13：Google未設定で全件JSONを書出し、日時付き新規名を提案する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    await put(app, data());
    const before = (await get(app)).body;
    const exported = await post(app, "export");
    expect(exported.statusCode).toBe(200);
    const snapshot = verifyBackup(exported.json());
    expect(snapshot.manifest.counts.clients).toBe(1);
    expect(exported.headers["content-disposition"]).toBeUndefined();
    expect(
      decodeURIComponent(exported.headers["x-invoice-backup-file"]),
    ).toMatch(/請求管理ツール_バックアップ_[0-9]{14}_[a-f0-9-]+\.json/);
    expect(exported.headers["cache-control"]).toBe("no-store");
    expect((await get(app)).body).toBe(before);
    const next = await post(app, "export");
    expect(next.json().manifest.backupId).not.toBe(snapshot.manifest.backupId);
    expect(next.headers["x-invoice-backup-file"]).not.toBe(
      exported.headers["x-invoice-backup-file"],
    );
    expect(
      (await app.inject({ url: "/api/backup/status", headers })).json(),
    ).toMatchObject({ mode: "file", lastBackup: null });
  } finally {
    await app.close();
  }
});

test("S20-T11/T15：ファイル内容の確認はDBを変えず、別ファイルの確認で旧結果を無効化する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    await put(app, data());
    const backup = (await post(app, "export")).json();
    const current = (await get(app)).json();
    current.companies[0].name = "変更後（架空）";
    await put(app, current);
    const first = await post(app, "preview", { backup });
    expect(first.statusCode).toBe(200);
    expect(first.json()).not.toHaveProperty("body");
    expect((await get(app)).json().companies[0].name).toBe("変更後（架空）");
    await post(app, "preview", {
      backup,
      previousToken: first.json().previewToken,
    });
    expect(
      (await post(app, "restore", { previewToken: first.json().previewToken }))
        .statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});

test("S20-T04/T09/T11：退避を検証して全件復元し、再起動後も旧画面の保存を拒否する", async () => {
  const directory = folder(),
    path = join(directory, "db.sqlite");
  let app = createApp({ path });
  try {
    await put(app, data());
    const snapshot = (await post(app, "export")).json();
    const stale = (await get(app)).json();
    stale.companies[0].name = "復元直前（架空）";
    await put(app, stale);
    const expected = (await post(app, "export")).json();
    const preview = (await post(app, "preview", { backup: snapshot })).json();
    expect(
      (await post(app, "restore", { previewToken: preview.previewToken }))
        .statusCode,
    ).toBe(200);
    expect((await get(app)).json().companies[0].name).toBe("青葉制作（架空）");
    const saved = join(
      directory,
      "restore-backups",
      readdirSync(join(directory, "restore-backups"))[0],
    );
    const copy = new DatabaseSync(saved, { readOnly: true });
    try {
      expect(captureBackup(copy).manifest.checksum).toBe(
        expected.manifest.checksum,
      );
    } finally {
      copy.close();
    }
    expect(statSync(saved).mode & 0o077).toBe(0);
    expect(
      (await post(app, "restore", { previewToken: preview.previewToken }))
        .statusCode,
    ).toBe(409);
    await app.close();
    app = createApp({ path });
    expect((await put(app, stale)).statusCode).toBe(409);
    const fresh = await get(app);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/11",
          headers: {
            ...headers,
            "x-invoice-database-generation":
              fresh.headers["x-invoice-database-generation"],
          },
          payload: fresh.json(),
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("S20-T03/T07/T09：破損・設定JSON・確認後の編集・確認なし・不正送信元を拒否する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    await put(app, data());
    const backup = (await post(app, "export")).json();
    for (const invalid of [
      null,
      {},
      { installed: { client_secret: "fictional" } },
      { ...backup, manifest: { ...backup.manifest, schemaVersion: 999 } },
    ]) {
      expect((await post(app, "preview", { backup: invalid })).statusCode).toBe(
        400,
      );
    }
    const preview = (await post(app, "preview", { backup })).json();
    const current = (await get(app)).json();
    current.companies[0].name = "確認後（架空）";
    await put(app, current);
    expect(
      (await post(app, "restore", { previewToken: preview.previewToken }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post(app, "restore", { previewToken: "unknown" })).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/backup/export",
          headers: { host: headers.host },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect((await get(app)).json().companies[0].name).toBe("確認後（架空）");
  } finally {
    await app.close();
  }
});

test("S20-T07：20MiBを超える復元入力は日本語で拒否する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const response = await post(app, "preview", {
      backup: "x".repeat(20 * 1024 * 1024 + 1),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().message).toContain("サイズ");
  } finally {
    await app.close();
  }
});

test("S20-T14/T17：旧Google操作を公開せず、設定・トークンを読み込まない", async () => {
  const directory = folder(),
    google = join(directory, "google-backup");
  mkdirSync(google);
  writeFileSync(join(google, "client.json"), "壊れた設定");
  writeFileSync(join(google, "tokens.json"), "secret-not-for-backup");
  const app = createApp({ path: join(directory, "db.sqlite") });
  try {
    for (const action of ["configure", "start"])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/google/" + action,
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
    const exported = await post(app, "export");
    expect(exported.statusCode).toBe(200);
    expect(exported.body).not.toMatch(
      /client_secret|secret-not-for-backup|google-backup/,
    );
    expect(readFileSync(join(google, "tokens.json"), "utf8")).toBe(
      "secret-not-for-backup",
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("S20-T18/T19：最新日時と保存場所は完了報告後に記録し、再起動後も保持する", async () => {
  const directory = folder(),
    path = join(directory, "db.sqlite");
  let app = createApp({ path });
  try {
    const backup = (await post(app, "export")).json();
    const recorded = await post(app, "record", {
      backupId: backup.manifest.backupId,
      fileName: "backup.json",
      location: "請求バックアップ/backup.json",
      method: "directory",
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json().lastBackup).toMatchObject({
      createdAt: backup.manifest.createdAt,
      fileName: "backup.json",
      location: "請求バックアップ/backup.json",
      method: "directory",
    });
    expect(recorded.json().lastBackup.savedAt).toBeTruthy();
    await post(app, "export");
    await app.close();
    app = createApp({ path });
    const status = (
      await app.inject({ url: "/api/backup/status", headers })
    ).json();
    expect(status.lastBackup).toEqual(recorded.json().lastBackup);
    expect(
      (
        await post(app, "record", {
          backupId: "unknown",
          fileName: "fake.json",
          location: "fake",
          method: "directory",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ url: "/api/backup/status", headers })).json(),
    ).toEqual(status);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("S20-T18/T19：壊れた最新記録を表示せず、DBと新しいバックアップは利用できる", async () => {
  const directory = folder(),
    state = join(directory, "backup-state");
  mkdirSync(state);
  writeFileSync(
    join(state, "latest.json"),
    JSON.stringify({ savedAt: "invalid", location: "broken" }),
    { mode: 0o600 },
  );
  const app = createApp({ path: join(directory, "db.sqlite") });
  try {
    const status = (
      await app.inject({ url: "/api/backup/status", headers })
    ).json();
    expect(status.lastBackup).toBeNull();
    expect(status.recordWarning).toContain("記録");
    expect((await post(app, "export")).statusCode).toBe(200);
    expect((await put(app, data())).statusCode).toBe(200);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
