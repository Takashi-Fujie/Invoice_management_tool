import { test, expect } from "vitest";
import { createApp } from "../server/app.mjs";
import { captureBackup } from "../server/backup.mjs";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const destination = "test-spreadsheet";
const put = (app, payload) =>
  app.inject({ method: "PUT", url: "/api/month/2026/11", headers, payload });
const post = (app, action, payload) =>
  app.inject({
    method: "POST",
    url: `/api/backup/${action}`,
    headers,
    payload: { connectionId: "connection-one", ...payload },
  });
const data = (name) => ({
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
function setup(path = ":memory:") {
  let archived,
    failure = false,
    selected = destination,
    connectionId = "connection-one",
    googleCalls = 0;
  const google = {
    upload: async (_destination, snapshot) => {
      googleCalls++;
      if (failure) throw Error("private google error");
      archived = snapshot;
      return {
        title: "請求管理ツール_バックアップ_202611031230",
        sheetId: 1,
        manifest: snapshot.manifest,
      };
    },
    list: async () => [
      {
        sheetId: 1,
        title: "請求管理ツール_バックアップ_202611031230",
        createdAt: archived.manifest.createdAt,
      },
    ],
    download: async () => archived,
  };
  const auth = {
    status: () => ({ configured: true, connected: !!selected }),
    selectedFile: () =>
      selected ? { id: selected, name: "架空バックアップ用" } : null,
    selectionKey: () => connectionId,
    getAccessToken: async () => "test",
    configure: () => {},
    start: () => {},
    finish: () => {},
  };
  const app = createApp({ path, backupOptions: { google, auth } });
  return {
    app,
    get googleCalls() {
      return googleCalls;
    },
    get connectionId() {
      return connectionId;
    },
    changeSelection(id) {
      selected = id;
      connectionId += "-new";
    },
    setFailure: () => {
      failure = true;
    },
    clearFailure: () => {
      failure = false;
    },
    get snapshot() {
      return archived;
    },
  };
}

test("S20-T09/T11：確認だけでは変えず、確認した世代を退避付きで全件復元する", async () => {
  const directory = mkdtempSync(join(tmpdir(), "invoice-s20-api-")),
    { app } = setup(join(directory, "db.sqlite"));
  try {
    expect((await put(app, data("元の架空会社"))).statusCode).toBe(200);
    const backup = await post(app, "run", {
      destination,
      requestId: "request-one",
    });
    expect(backup.statusCode).toBe(200);
    const current = (
      await app.inject({ url: "/api/month/2026/11", headers })
    ).json();
    current.companies[0].name = "変更後の架空会社";
    expect((await put(app, current)).statusCode).toBe(200);
    const preview = await post(app, "preview", { destination, sheetId: 1 });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).not.toHaveProperty("body");
    expect(
      (await app.inject({ url: "/api/month/2026/11", headers })).json()
        .companies[0].name,
    ).toBe("変更後の架空会社");
    const restored = await post(app, "restore", {
      previewToken: preview.json().previewToken,
    });
    expect(restored.statusCode).toBe(200);
    const response = await app.inject({ url: "/api/month/2026/11", headers });
    expect(response.json().companies[0].name).toBe("元の架空会社");
    expect(
      readdirSync(join(directory, "restore-backups")).some((name) =>
        name.endsWith(".sqlite"),
      ),
    ).toBe(true);
    expect(
      (
        await post(app, "restore", {
          previewToken: preview.json().previewToken,
        })
      ).statusCode,
    ).toBe(409);
    expect((await put(app, current)).statusCode).toBe(409);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("S20-T09：確認後の別画面での編集・不正な送信元・確認なしの復元を拒否する", async () => {
  const { app } = setup();
  try {
    await put(app, data("架空会社"));
    await post(app, "run", { destination, requestId: "request-one" });
    const preview = (
      await post(app, "preview", { destination, sheetId: 1 })
    ).json();
    const current = (
      await app.inject({ url: "/api/month/2026/11", headers })
    ).json();
    current.companies[0].name = "確認後の変更";
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
          url: "/api/backup/run",
          headers: { host: headers.host },
          payload: { destination },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: "/api/month/2026/11", headers })).json()
        .companies[0].name,
    ).toBe("確認後の変更");
  } finally {
    await app.close();
  }
});

test("S20-T06/T09：失敗後も同じバックアップを再試行し、秘密情報を応答しない", async () => {
  const state = setup(),
    { app } = state;
  try {
    await put(app, data("架空会社"));
    state.setFailure();
    const failed = await post(app, "run", {
      destination,
      requestId: "retry-one",
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain("private google error");
    state.clearFailure();
    expect(
      (await post(app, "run", { destination, requestId: "retry-one" }))
        .statusCode,
    ).toBe(200);
    const id = state.snapshot.manifest.backupId;
    expect(
      (await post(app, "run", { destination, requestId: "retry-one" }))
        .statusCode,
    ).toBe(200);
    expect(state.snapshot.manifest.backupId).toBe(id);
    const status = await app.inject({ url: "/api/backup/status", headers });
    expect(status.statusCode).toBe(200);
    expect(status.body).not.toContain("test-token");
  } finally {
    await app.close();
  }
});

test("S20-T09：復元後に再起動しても旧画面の保存を拒否し、新しく読み込んだ画面は保存できる", async () => {
  const directory = mkdtempSync(join(tmpdir(), "invoice-s20-generation-")),
    path = join(directory, "db.sqlite");
  let { app } = setup(path);
  try {
    const stale = (await put(app, data("復元前の架空会社"))).json();
    await post(app, "run", { destination, requestId: "request-one" });
    const preview = (
      await post(app, "preview", { destination, sheetId: 1 })
    ).json();
    expect(
      (await post(app, "restore", { previewToken: preview.previewToken }))
        .statusCode,
    ).toBe(200);
    await app.close();
    ({ app } = setup(path));
    expect((await put(app, stale)).statusCode).toBe(409);
    const current = await app.inject({ url: "/api/month/2026/11", headers });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/month/2026/11",
          headers: {
            ...headers,
            "x-invoice-database-generation":
              current.headers["x-invoice-database-generation"],
          },
          payload: current.json(),
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("S20-T15：URLの差替えや未選択の実行をGoogle通信より前に拒否する", async () => {
  const state = setup(),
    { app } = state;
  try {
    for (const action of ["run", "list", "preview"]) {
      const response = await post(app, action, {
        destination: "foreign-spreadsheet",
        sheetId: 1,
        requestId: "foreign-request",
      });
      expect(response.statusCode).toBe(403);
    }
    expect(state.googleCalls).toBe(0);
    state.changeSelection(null);
    expect(
      (await post(app, "run", { destination, requestId: "no-selection" }))
        .statusCode,
    ).toBe(401);
    expect(state.googleCalls).toBe(0);
  } finally {
    await app.close();
  }
});

test("S20-T15：同じファイルでも再認証後に古い確認・再試行を再利用しない", async () => {
  const state = setup(),
    { app } = state;
  try {
    await put(app, data("元の架空会社"));
    await post(app, "run", { destination, requestId: "before-reselect" });
    const preview = (
      await post(app, "preview", { destination, sheetId: 1 })
    ).json();
    state.changeSelection(destination);
    expect(
      (await post(app, "restore", { previewToken: preview.previewToken }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post(app, "run", { destination, requestId: "before-reselect" }))
        .statusCode,
    ).toBe(409);
    expect(state.googleCalls).toBe(1);
    expect(
      (await app.inject({ url: "/api/month/2026/11", headers })).json()
        .companies[0].name,
    ).toBe("元の架空会社");
    expect(
      (
        await post(app, "run", {
          destination,
          requestId: "after-reselect",
          connectionId: state.connectionId,
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
