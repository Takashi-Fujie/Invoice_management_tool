import { test, expect } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleConnection } from "../server/google-auth.mjs";

const config = {
  installed: {
    client_id: "example.apps.googleusercontent.com",
    client_secret: "test-secret",
  },
};
function factory() {
  let exchanges = 0;
  const make = () => ({
    setCredentials() {},
    on() {},
    generateCodeVerifierAsync: async () => ({
      codeVerifier: "test-verifier",
      codeChallenge: "test-challenge",
    }),
    generateAuthUrl: (options) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(options)}`,
    getToken: async (options) => {
      exchanges++;
      expect(options.codeVerifier).toBe("test-verifier");
      return {
        tokens: {
          access_token: "test-access",
          refresh_token: "test-refresh",
          expiry_date: Date.now() + 3600000,
        },
      };
    },
    getAccessToken: async () => ({ token: "test-access" }),
    getTokenInfo: async () => ({
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      aud: config.installed.client_id,
    }),
  });
  return {
    make,
    get exchanges() {
      return exchanges;
    },
  };
}
test("S20-T08：OAuthの状態・PKCEを検証し、鍵を所有者専用で保存して再起動後も使う", async () => {
  const directory = mkdtempSync(join(tmpdir(), "invoice-s20-auth-")),
    fake = factory();
  try {
    const connection = new GoogleConnection({
      directory,
      port: 8787,
      clientFactory: fake.make,
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          id: "chosen-spreadsheet",
          name: "架空バックアップ用",
          mimeType: "application/vnd.google-apps.spreadsheet",
          capabilities: { canEdit: true },
        }),
      }),
    });
    expect(connection.status()).toEqual({
      configured: false,
      connected: false,
    });
    connection.configure(config);
    const { url } = await connection.start("/?year=2025&month=12");
    const parsed = new URL(url),
      state = parsed.searchParams.get("state");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    await expect(
      connection.finish({ state: "wrong", code: "x" }),
    ).rejects.toThrow();
    expect(fake.exchanges).toBe(0);
    expect(
      await connection.finish({
        state,
        code: "valid",
        picked_file_ids: "chosen-spreadsheet",
      }),
    ).toBe("/?year=2025&month=12&backup=open");
    await expect(
      connection.finish({
        state,
        code: "valid",
        picked_file_ids: "chosen-spreadsheet",
      }),
    ).rejects.toThrow();
    expect(fake.exchanges).toBe(1);
    expect(statSync(join(directory, "tokens.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "client.json")).mode & 0o777).toBe(0o600);
    expect(connection.status()).toMatchObject({
      configured: true,
      connected: true,
      selectedFile: { id: "chosen-spreadsheet" },
    });
    expect(JSON.stringify(connection.status())).not.toContain("test-access");
    const restarted = new GoogleConnection({
      directory,
      port: 8787,
      clientFactory: fake.make,
    });
    expect(await restarted.getAccessToken("chosen-spreadsheet")).toBe(
      "test-access",
    );
    expect(() =>
      connection.configure({
        installed: {
          client_id: "evil",
          client_secret: "x",
          token_uri: "https://evil.example",
        },
      }),
    ).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("S20-T08：期限切れの認証要求と外部への戻り先を拒否する", async () => {
  let now = 1000;
  const connection = new GoogleConnection({
    directory: null,
    port: 8787,
    clientFactory: factory().make,
    clock: () => now,
  });
  connection.configure(config);
  const { url } = await connection.start("https://evil.example");
  const state = new URL(url).searchParams.get("state");
  now += 11 * 60000;
  await expect(
    connection.finish({
      state,
      code: "valid",
      picked_file_ids: "chosen-spreadsheet",
    }),
  ).rejects.toThrow();
});

test("S20-T08：接続ファイルが壊れてもアプリは起動でき、設定し直せる", () => {
  const directory = mkdtempSync(join(tmpdir(), "invoice-s20-broken-auth-"));
  try {
    writeFileSync(join(directory, "client.json"), "invalid json", {
      mode: 0o600,
    });
    const connection = new GoogleConnection({
      directory,
      port: 8787,
      clientFactory: factory().make,
    });
    expect(connection.status().connected).toBe(false);
    expect(connection.status().setupError).toContain("接続設定");
    connection.configure(config);
    expect(connection.status().setupError).toBeUndefined();
    expect(connection.status().configured).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
