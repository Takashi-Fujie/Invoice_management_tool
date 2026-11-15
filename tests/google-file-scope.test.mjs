import { test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleConnection } from "../server/google-auth.mjs";

const scope = "https://www.googleapis.com/auth/drive.file";
const clientId = "example.apps.googleusercontent.com";
const config = {
  installed: { client_id: clientId, client_secret: "fictional" },
};
function setup(directory = null) {
  const controls = {
    scopes: [scope],
    aud: clientId,
    mime: "application/vnd.google-apps.spreadsheet",
    canEdit: true,
    fetchFailure: false,
    refresh: false,
    refreshCount: 0,
    reads: [],
  };
  const clientFactory = () => {
    const listeners = [];
    const client = {
      credentials: {},
      setCredentials(tokens) {
        this.credentials = tokens;
      },
      on(_event, callback) {
        listeners.push(callback);
      },
      generateCodeVerifierAsync: async () => ({
        codeVerifier: "verifier",
        codeChallenge: "challenge",
      }),
      generateAuthUrl: (options) =>
        `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(options)}`,
      getToken: async () => ({
        tokens: {
          access_token: "private-access",
          refresh_token: "private-refresh",
          scope,
        },
      }),
      getTokenInfo: async () => ({
        scopes: controls.scopes,
        aud: controls.aud,
      }),
      async getAccessToken() {
        if (controls.refresh) {
          const tokens = {
            access_token: `private-renewed-${++controls.refreshCount}`,
            scope,
          };
          this.credentials = { ...this.credentials, ...tokens };
          listeners.forEach((listener) => listener(tokens));
        }
        return { token: this.credentials.access_token };
      },
    };
    return client;
  };
  const connection = new GoogleConnection({
    directory,
    port: 8787,
    clientFactory,
    fetcher: async (url, options) => {
      controls.reads.push({ url, options });
      if (controls.fetchFailure) throw Error("private transport details");
      const id = new URL(url).pathname.split("/").at(-1);
      return {
        ok: true,
        json: async () => ({
          id,
          name: "架空バックアップ用",
          mimeType: controls.mime,
          capabilities: { canEdit: controls.canEdit },
        }),
      };
    },
  });
  connection.configure(config);
  async function choose(id = "chosen-spreadsheet", extras = {}) {
    const { url } = await connection.start("/annual.html?year=2026");
    return connection.finish({
      state: new URL(url).searchParams.get("state"),
      code: "code",
      picked_file_ids: id,
      scope,
      ...extras,
    });
  }
  return { connection, controls, choose, clientFactory };
}

test("S20-T13：全体権限を要求せずGoogleの単一ファイル選択から保存先を確定する", async () => {
  const { connection, controls, choose } = setup();
  const parsed = new URL((await connection.start()).url);
  expect(parsed.searchParams.get("scope")).toBe(scope);
  expect(parsed.searchParams.get("include_granted_scopes")).toBe("false");
  expect(parsed.searchParams.get("trigger_onepick")).toBe("true");
  expect(parsed.searchParams.get("allow_multiple")).toBe("false");
  expect(parsed.searchParams.get("mimetypes")).toBe(
    "application/vnd.google-apps.spreadsheet",
  );
  await choose();
  expect(connection.status().selectedFile).toMatchObject({
    id: "chosen-spreadsheet",
    name: "架空バックアップ用",
  });
  expect(await connection.getAccessToken("chosen-spreadsheet")).toBe(
    "private-access",
  );
  await expect(
    connection.getAccessToken("other-spreadsheet"),
  ).rejects.toThrow();
  expect(controls.reads).toHaveLength(1);
  expect(JSON.stringify(connection.status())).not.toContain("private-access");
});

test("S20-T14：取消・不正な選択・編集不可・広い権限・別アプリ・通信失敗で元の接続を保つ", async () => {
  const { connection, controls, choose } = setup();
  await choose();
  const previous = connection.status();
  const { url } = await connection.start();
  await connection.finish({
    state: new URL(url).searchParams.get("state"),
    error: "access_denied",
  });
  expect(connection.status().selectedFile).toEqual(previous.selectedFile);
  for (const id of [
    undefined,
    "",
    "chosen-spreadsheet,other-spreadsheet",
    "https://evil.example",
  ]) {
    await expect(choose(id, { picked_file_ids: id })).rejects.toThrow();
    expect(connection.status().selectedFile).toEqual(previous.selectedFile);
  }
  for (const changes of [
    { mime: "text/plain" },
    { canEdit: false },
    { scopes: [scope, "https://www.googleapis.com/auth/spreadsheets"] },
    { aud: "other.apps.googleusercontent.com" },
    { fetchFailure: true },
  ]) {
    const original = Object.fromEntries(
      Object.keys(changes).map((key) => [key, controls[key]]),
    );
    Object.assign(controls, changes);
    await expect(choose("other-spreadsheet")).rejects.toThrow();
    expect(connection.status().selectedFile).toEqual(previous.selectedFile);
    expect(connection.status().connectionId).toBe(previous.connectionId);
    Object.assign(controls, original);
  }
});

test("S20-T13/T16：古い全体権限は再利用せず、端末別の選択と狭い権限を再起動後に保持する", async () => {
  const a = mkdtempSync(join(tmpdir(), "invoice-selected-a-"));
  const b = mkdtempSync(join(tmpdir(), "invoice-selected-b-"));
  try {
    writeFileSync(join(a, "client.json"), JSON.stringify(config.installed), {
      mode: 0o600,
    });
    writeFileSync(
      join(a, "tokens.json"),
      JSON.stringify({
        access_token: "legacy",
        refresh_token: "legacy",
        scope: "https://www.googleapis.com/auth/spreadsheets",
      }),
      { mode: 0o600 },
    );
    const legacy = new GoogleConnection({ directory: a, port: 8787 });
    expect(legacy.status().connected).toBe(false);
    await expect(legacy.getAccessToken("chosen-spreadsheet")).rejects.toThrow();
    const first = setup(a),
      second = setup(b);
    await first.choose("chosen-spreadsheet");
    await second.choose("other-spreadsheet");
    const restarted = new GoogleConnection({
      directory: a,
      port: 8787,
      clientFactory: first.clientFactory,
    });
    expect(restarted.status().selectedFile.id).toBe("chosen-spreadsheet");
    expect(second.connection.status().selectedFile.id).toBe(
      "other-spreadsheet",
    );
    await expect(
      restarted.getAccessToken("other-spreadsheet"),
    ).rejects.toThrow();
    first.controls.refresh = true;
    expect(await restarted.getAccessToken("chosen-spreadsheet")).toBe(
      "private-renewed-1",
    );
    first.controls.scopes = ["https://www.googleapis.com/auth/spreadsheets"];
    await expect(
      restarted.getAccessToken("chosen-spreadsheet"),
    ).rejects.toThrow();
    expect(restarted.status().connected).toBe(false);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});
