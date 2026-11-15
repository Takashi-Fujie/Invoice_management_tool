import { randomInt } from "node:crypto";
import {
  backupTitle,
  encodeBackup,
  decodeBackup,
  verifyBackup,
} from "./backup.mjs";

const PREFIX = /^請求管理ツール_バックアップ_[0-9]{12}$/;
const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
export function spreadsheetId(input) {
  if (typeof input !== "string")
    throw fail("保存先のスプレッドシートURLを入力してください。");
  let id = input.trim();
  if (id.startsWith("https://")) {
    let url;
    try {
      url = new URL(id);
    } catch {
      throw fail("スプレッドシートのURLを確認してください。");
    }
    if (
      url.hostname !== "docs.google.com" ||
      url.port ||
      url.username ||
      url.password
    )
      throw fail("GoogleスプレッドシートのURLを指定してください。");
    id =
      /^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/.exec(url.pathname)?.[1] ||
      "";
  }
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id))
    throw fail("スプレッドシートのURLを確認してください。");
  return id;
}

export class GoogleSheetsBackup {
  constructor({ getAccessToken, fetcher = fetch }) {
    this.getAccessToken = getAccessToken;
    this.fetcher = fetcher;
  }
  async request(id, suffix = "", options = {}) {
    const token = await this.getAccessToken(spreadsheetId(id));
    const response = await this.fetcher(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId(id)}${suffix}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30000),
      },
    ).catch(() => {
      throw fail(
        "Googleとの通信に失敗しました。保存先を変えずに再試行してください。",
        502,
      );
    });
    if (!response.ok) {
      const status = response.status;
      if (status === 401)
        throw fail(
          "Googleへの再接続が必要です。Google連携をやり直してください。",
          401,
        );
      if (status === 403 || status === 404)
        throw fail(
          "このGoogleアカウントで保存先へアクセスできません。編集権限とURLを確認してください。",
          403,
        );
      throw fail(
        status === 429
          ? "Googleの利用制限に達しました。しばらく待って再試行してください。"
          : "Googleへの保存・読取に失敗しました。元のデータと以前のバックアップは保持しています。",
        502,
      );
    }
    return response.json();
  }
  meta(id) {
    return this.request(
      id,
      "?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
    );
  }
  async read(id, title, { manifestOnly = false } = {}) {
    const range = `'${title.replaceAll("'", "''")}'!A${manifestOnly ? "1:H2" : ":H"}`;
    const result = await this.request(
      id,
      `?includeGridData=true&ranges=${encodeURIComponent(range)}&fields=sheets(data(rowData(values(userEnteredValue))))`,
    );
    return this.rows(result.sheets?.[0]);
  }
  rows(sheet) {
    const rows = (sheet?.data?.[0]?.rowData || []).map((row) => {
      const cells = (row.values || []).map((cell) => {
        const value = cell.userEnteredValue;
        if (value === undefined) return "";
        if (
          typeof value.stringValue !== "string" ||
          Object.keys(value).length !== 1
        )
          throw fail(
            "バックアップに数式または想定外のセル値が含まれています。復元できません。",
          );
        return value.stringValue;
      });
      while (cells.length < 8) cells.push("");
      return cells;
    });
    while (rows.length && rows.at(-1).every((cell) => cell === "")) rows.pop();
    return rows;
  }
  async write(id, sheetId, rows, start = 0) {
    for (let offset = 0; offset < rows.length;) {
      const chunk = [];
      let bytes = 0;
      while (offset + chunk.length < rows.length) {
        const values = rows[offset + chunk.length].map((value) => ({
          userEnteredValue: { stringValue: value },
        }));
        const size = Buffer.byteLength(JSON.stringify(values));
        if (chunk.length && bytes + size > 900000) break;
        bytes += size;
        chunk.push({ values });
      }
      await this.request(id, ":batchUpdate", {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              updateCells: {
                start: { sheetId, rowIndex: start + offset, columnIndex: 0 },
                rows: chunk,
                fields: "userEnteredValue",
              },
            },
          ],
        }),
      });
      offset += chunk.length;
    }
  }
  async upload(destination, snapshot) {
    const id = spreadsheetId(destination),
      title = backupTitle(snapshot.manifest.createdAt);
    const rows = encodeBackup(verifyBackup(snapshot), { state: "WRITING" });
    const meta = await this.meta(id);
    const existing = meta.sheets?.find((s) => s.properties.title === title);
    let sheetId;
    if (existing) {
      const saved = await this.read(id, title);
      let previous;
      try {
        if (
          saved[1]?.[7] === "WRITING" &&
          JSON.stringify(saved.slice(0, 2)) === JSON.stringify(rows.slice(0, 2))
        )
          previous = snapshot;
        else previous = decodeBackup(saved, { allowWriting: true });
      } catch {
        throw fail(
          "同じ日時のタブが既にあります。既存のタブを上書きせず、次の分になってから再実行してください。",
          409,
        );
      }
      if (JSON.stringify(previous) !== JSON.stringify(snapshot))
        throw fail(
          "同じ日時のタブが既にあります。次の分になってから再実行してください。",
          409,
        );
      sheetId = existing.properties.sheetId;
      if (saved[1][7] === "COMPLETE")
        return {
          sheetId,
          title,
          url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${sheetId}`,
          manifest: snapshot.manifest,
        };
    } else {
      const used = (meta.sheets || []).reduce(
        (sum, s) =>
          sum +
          (s.properties.gridProperties?.rowCount || 0) *
            (s.properties.gridProperties?.columnCount || 0),
        0,
      );
      if (used + rows.length * 8 > 20000000)
        throw fail(
          "保存先のセル数上限を超えるため保存できません。以前のバックアップは削除していません。",
        );
      sheetId = randomInt(1, 2147483647);
      const added = await this.request(id, ":batchUpdate", {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  sheetId,
                  title,
                  gridProperties: {
                    rowCount: rows.length,
                    columnCount: 8,
                    frozenRowCount: 2,
                  },
                },
              },
            },
            {
              updateCells: {
                start: { sheetId, rowIndex: 0, columnIndex: 0 },
                rows: rows.slice(0, 2).map((row) => ({
                  values: row.map((value) => ({
                    userEnteredValue: { stringValue: value },
                  })),
                })),
                fields: "userEnteredValue",
              },
            },
          ],
        }),
      });
      sheetId = added.replies?.[0]?.addSheet?.properties?.sheetId ?? sheetId;
    }
    await this.write(id, sheetId, rows);
    const readback = decodeBackup(await this.read(id, title), {
      allowWriting: true,
    });
    if (JSON.stringify(readback) !== JSON.stringify(snapshot))
      throw fail(
        "Googleから読み戻した内容が一致しません。完了扱いにせず停止しました。",
        502,
      );
    await this.write(id, sheetId, [encodeBackup(snapshot)[1]], 1);
    const final = decodeBackup(await this.read(id, title));
    if (JSON.stringify(final) !== JSON.stringify(snapshot))
      throw fail(
        "バックアップの完了状態を確認できません。再試行してください。",
        502,
      );
    return {
      sheetId,
      title,
      url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${sheetId}`,
      manifest: snapshot.manifest,
    };
  }
  async list(destination) {
    const id = spreadsheetId(destination),
      meta = await this.meta(id),
      result = [];
    const candidates = (meta.sheets || []).filter((sheet) =>
      PREFIX.test(sheet.properties.title),
    );
    for (let offset = 0; offset < candidates.length; offset += 20) {
      const chunk = candidates.slice(offset, offset + 20);
      const ranges = chunk
        .map(
          (sheet) =>
            "ranges=" +
            encodeURIComponent("'" + sheet.properties.title + "'!A1:H2"),
        )
        .join("&");
      const response = await this.request(
        id,
        `?includeGridData=true&${ranges}&fields=sheets(properties(sheetId,title),data(rowData(values(userEnteredValue))))`,
      );
      for (const sheet of response.sheets || []) {
        const { title, sheetId } = sheet.properties || {};
        if (
          !chunk.some(
            (candidate) =>
              candidate.properties.sheetId === sheetId &&
              candidate.properties.title === title,
          )
        )
          continue;
        try {
          const rows = this.rows(sheet),
            manifest = JSON.parse(rows[1]?.[6] || "null");
          if (
            rows[1]?.[0] === "MANIFEST" &&
            rows[1]?.[7] === "COMPLETE" &&
            manifest?.format === "invoice-backup" &&
            manifest.formatVersion === 1 &&
            manifest.schemaVersion === 9 &&
            backupTitle(manifest.createdAt) === title
          )
            result.push({
              sheetId,
              title,
              createdAt: manifest.createdAt,
              counts: manifest.counts,
            });
        } catch {
          /* A malformed or incomplete tab is not a restore candidate. */
        }
      }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async download(destination, sheetId) {
    const id = spreadsheetId(destination);
    if (!Number.isInteger(sheetId) || sheetId < 0)
      throw fail("復元するバックアップを選んでください。");
    const meta = await this.meta(id),
      sheet = meta.sheets?.find((s) => s.properties.sheetId === sheetId);
    if (!sheet || !PREFIX.test(sheet.properties.title))
      throw fail("専用のバックアップタブを選んでください。");
    const result = decodeBackup(await this.read(id, sheet.properties.title));
    if (backupTitle(result.manifest.createdAt) !== sheet.properties.title)
      throw fail("バックアップ名と保存日時が一致しません。");
    return verifyBackup(result);
  }
}
