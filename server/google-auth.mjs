import { OAuth2Client } from "google-auth-library";
import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  chmodSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";

const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
export function savePrivateJSON(directory, name, value) {
  if (!directory) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink())
    throw fail("Google接続の保存先を確認してください。");
  chmodSync(directory, 0o700);
  const temporary = join(directory, `${name}.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  renameSync(temporary, join(directory, name));
}
export function readPrivateJSON(directory, name) {
  if (!directory || !existsSync(join(directory, name))) return null;
  try {
    const path = join(directory, name),
      stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.mode & 0o077)
      throw Error();
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw fail(
      "Google接続設定を読めません。所有者だけが読める設定ファイルを確認してください。",
    );
  }
}

const FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const validId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{8,160}$/.test(id);
const selectedURL = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export class GoogleConnection {
  constructor({
    directory,
    port,
    clientFactory = (options) => new OAuth2Client(options),
    clock = () => Date.now(),
    fetcher = fetch,
  }) {
    this.directory = directory;
    this.port = port;
    this.clientFactory = clientFactory;
    this.clock = clock;
    this.fetcher = fetcher;
    this.config = null;
    this.tokens = null;
    this.selection = null;
    this.connectionId = null;
    this.verifiedToken = null;
    this.setupError = null;
    this.selectionError = null;
    this.pending = new Map();
    try {
      this.config = readPrivateJSON(directory, "client.json");
      const saved = readPrivateJSON(directory, "tokens.json");
      if (saved) {
        if (
          saved.version === 2 &&
          saved.scope === FILE_SCOPE &&
          validId(saved.selection?.id) &&
          typeof saved.selection?.name === "string" &&
          typeof saved.connectionId === "string" &&
          saved.tokens &&
          (saved.tokens.refresh_token || saved.tokens.access_token)
        ) {
          this.tokens = saved.tokens;
          this.selection = saved.selection;
          this.connectionId = saved.connectionId;
        } else
          this.setupError =
            "以前のGoogle接続は使用できません。Googleで保存先を選び直してください。";
      }
    } catch (error) {
      this.setupError = error.message;
    }
  }
  status() {
    const connected = !!(
      this.config &&
      this.selection &&
      this.tokens &&
      (this.tokens.refresh_token || this.tokens.access_token)
    );
    return {
      configured: !!this.config,
      connected,
      ...(connected
        ? { selectedFile: this.selectedFile(), connectionId: this.connectionId }
        : {}),
      ...(this.setupError ? { setupError: this.setupError } : {}),
      ...(this.selectionError ? { selectionError: this.selectionError } : {}),
    };
  }
  selectedFile() {
    return this.selection && this.tokens
      ? { ...this.selection, url: selectedURL(this.selection.id) }
      : null;
  }
  selectionKey() {
    return this.connectionId;
  }
  saveSession(tokens, selection, connectionId) {
    savePrivateJSON(this.directory, "tokens.json", {
      version: 2,
      scope: FILE_SCOPE,
      tokens,
      selection,
      connectionId,
    });
    this.tokens = tokens;
    this.selection = selection;
    this.connectionId = connectionId;
  }
  configure(input) {
    const value = input?.installed;
    if (
      !value ||
      typeof value.client_id !== "string" ||
      !value.client_id.endsWith(".apps.googleusercontent.com") ||
      value.client_id.length > 500 ||
      typeof value.client_secret !== "string" ||
      !value.client_secret ||
      value.client_secret.length > 4096
    )
      throw fail(
        "Google Cloudで作成した「デスクトップ アプリ」のOAuthクライアントJSONを選んでください。",
      );
    const config = {
      client_id: value.client_id,
      client_secret: value.client_secret,
    };
    savePrivateJSON(this.directory, "tokens.json", null);
    savePrivateJSON(this.directory, "client.json", config);
    this.config = config;
    this.tokens = null;
    this.selection = null;
    this.connectionId = null;
    this.verifiedToken = null;
    this.pending.clear();
    this.setupError = null;
    this.selectionError = null;
  }
  client(tokens = null) {
    if (!this.config) throw fail("先にGoogle接続の初期設定を行ってください。");
    const client = this.clientFactory({
      clientId: this.config.client_id,
      clientSecret: this.config.client_secret,
      redirectUri: `http://127.0.0.1:${this.port}/api/google/callback`,
    });
    if (tokens) client.setCredentials(tokens);
    return client;
  }
  async verifyScope(client, token) {
    const info = await client.getTokenInfo(token);
    if (
      !Array.isArray(info.scopes) ||
      info.scopes.length !== 1 ||
      info.scopes[0] !== FILE_SCOPE ||
      info.aud !== this.config.client_id
    )
      throw Object.assign(
        fail(
          "選択したファイルだけへのGoogle許可を確認できません。Googleアカウントでこのアプリへの以前の許可を解除してから、保存先を選び直してください。",
          401,
        ),
        { invalidScope: true },
      );
  }
  async start(returnTo = "/") {
    const client = this.client(),
      state = randomBytes(32).toString("hex"),
      { codeVerifier, codeChallenge } =
        await client.generateCodeVerifierAsync();
    let target = "/";
    try {
      const url = new URL(returnTo, "http://127.0.0.1");
      if (
        url.origin === "http://127.0.0.1" &&
        ["/", "/annual.html"].includes(url.pathname)
      ) {
        url.searchParams.set("backup", "open");
        target = url.pathname + url.search;
      }
    } catch {
      /* Invalid return destinations use the local home page. */
    }
    for (const [key, value] of this.pending)
      if (value.expires < this.clock()) this.pending.delete(key);
    if (this.pending.size >= 10)
      throw fail(
        "Google連携の開始回数が多すぎます。少し待って再試行してください。",
        429,
      );
    this.pending.set(state, {
      client,
      codeVerifier,
      target,
      config: this.config,
      expires: this.clock() + 10 * 60000,
    });
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: FILE_SCOPE,
      include_granted_scopes: false,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    const picker = new URL(url);
    picker.searchParams.set("trigger_onepick", "true");
    picker.searchParams.set("allow_multiple", "false");
    picker.searchParams.set("mimetypes", SHEET_MIME);
    return { url: picker.href };
  }
  async finish({ state, code, error, picked_file_ids }) {
    const pending = typeof state === "string" ? this.pending.get(state) : null;
    if (
      !pending ||
      pending.expires < this.clock() ||
      pending.config !== this.config
    )
      throw fail(
        "Google連携の確認が切れました。アプリから連携をやり直してください。",
      );
    this.pending.delete(state);
    if (error === "access_denied") {
      this.selectionError =
        "保存先の選択をキャンセルしました。以前の保存先は変更していません。";
      return pending.target;
    }
    if (
      error ||
      typeof code !== "string" ||
      !code ||
      code.length > 8192 ||
      !validId(picked_file_ids)
    )
      throw fail(
        "Googleでバックアップ用スプレッドシートを1つ選んでください。以前の保存先は変更していません。",
      );
    try {
      const { tokens } = await pending.client.getToken({
        code,
        codeVerifier: pending.codeVerifier,
        redirect_uri: `http://127.0.0.1:${this.port}/api/google/callback`,
      });
      if (typeof tokens.access_token !== "string" || !tokens.access_token)
        throw Error();
      await this.verifyScope(pending.client, tokens.access_token);
      const response = await this.fetcher(
        `https://www.googleapis.com/drive/v3/files/${picked_file_ids}?fields=id,name,mimeType,capabilities(canEdit)&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) throw Error();
      const file = await response.json();
      if (
        file.id !== picked_file_ids ||
        file.mimeType !== SHEET_MIME ||
        file.capabilities?.canEdit !== true ||
        typeof file.name !== "string"
      )
        throw Error();
      if (pending.config !== this.config) throw Error();
      this.saveSession(tokens, { id: file.id, name: file.name }, randomUUID());
      this.verifiedToken = tokens.access_token;
      this.setupError = null;
      this.selectionError = null;
      // Only the most recently completed selection can establish the connection.
      this.pending.clear();
      return pending.target;
    } catch (error) {
      if (error?.invalidScope) throw error;
      throw fail(
        "選択したファイルの種類・編集権限・Google許可を確認できません。保存先は変更していません。Googleで選び直してください。",
      );
    }
  }
  async getAccessToken(destination) {
    if (!this.status().connected)
      throw fail("Googleで保存先を選んでください。", 401);
    if (destination !== this.selection.id)
      throw fail("Googleで選択した保存先だけを操作できます。", 403);
    const connectionId = this.connectionId;
    try {
      const client = this.client(this.tokens);
      let updated = this.tokens;
      client.on("tokens", (tokens) => {
        updated = { ...updated, ...tokens };
      });
      const result = await client.getAccessToken();
      if (typeof result.token !== "string" || !result.token) throw Error();
      if (this.verifiedToken !== result.token)
        await this.verifyScope(client, result.token);
      if (connectionId !== this.connectionId) throw Error();
      this.saveSession(
        { ...updated, access_token: result.token },
        this.selection,
        connectionId,
      );
      this.verifiedToken = result.token;
      return result.token;
    } catch (error) {
      if (error?.invalidScope && this.connectionId === connectionId) {
        savePrivateJSON(this.directory, "tokens.json", null);
        this.tokens = null;
        this.selection = null;
        this.connectionId = null;
        this.verifiedToken = null;
      }
      throw fail(
        "Googleへの再接続が必要です。Googleで保存先を選び直してください。",
        401,
      );
    }
  }
}
