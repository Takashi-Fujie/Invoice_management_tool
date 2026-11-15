import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { migrateDatabase } from "./migrations.mjs";

export const TABLES = [
  "clients",
  "billable_items",
  "invoices",
  "invoice_lines",
  "client_month_visibility",
];
const HEADER = [
  "種別",
  "バックアップID",
  "対象",
  "順序",
  "分割番号",
  "分割数",
  "データ",
  "状態",
];
const FORMAT = "invoice-backup";
const fail = () => {
  throw Object.assign(
    new Error(
      "バックアップの内容・版・整合性を確認できません。元のデータは変更していません。",
    ),
    { statusCode: 400 },
  );
};
const sha = (text) => createHash("sha256").update(text).digest("hex");
const schemaOf = (db) =>
  Object.fromEntries(
    TABLES.map((name) => [
      name,
      db
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map((r) => ({
          name: r.name,
          type: r.type,
          notnull: r.notnull,
          default: r.dflt_value,
          pk: r.pk,
        })),
    ]),
  );
const template = new DatabaseSync(":memory:");
migrateDatabase(template, ":memory:");
const SCHEMA = schemaOf(template);
template.close();

export function backupTitle(createdAt) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return fail();
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `請求管理ツール_バックアップ_${values.year}${values.month}${values.day}${values.hour}${values.minute}`;
}

export function captureBackup(
  db,
  { now = new Date(), id = randomUUID(), transaction = true } = {},
) {
  if (transaction) db.exec("BEGIN");
  try {
    if (
      db.prepare("PRAGMA user_version").get().user_version !== 9 ||
      JSON.stringify(schemaOf(db)) !== JSON.stringify(SCHEMA)
    )
      fail();
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name)
      .sort();
    if (JSON.stringify(names) !== JSON.stringify([...TABLES].sort())) fail();
    if (
      db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      fail();
    const tables = Object.fromEntries(
      TABLES.map((name) => {
        const statement = db.prepare(`SELECT * FROM ${name} ORDER BY rowid`);
        statement.setReadBigInts(true);
        return [
          name,
          statement
            .all()
            .map((row) =>
              SCHEMA[name].map((column) =>
                row[column.name] === null ? null : String(row[column.name]),
              ),
            ),
        ];
      }),
    );
    const body = { schema: structuredClone(SCHEMA), tables };
    const manifest = {
      format: FORMAT,
      formatVersion: 1,
      schemaVersion: 9,
      backupId: id,
      createdAt: now.toISOString(),
      counts: Object.fromEntries(
        TABLES.map((name) => [name, tables[name].length]),
      ),
      checksum: sha(JSON.stringify(body)),
    };
    if (transaction) db.exec("COMMIT");
    return { manifest, body };
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    throw error;
  }
}

function chunksOf(text) {
  const chunks = [];
  let part = "";
  for (const char of text) {
    if (part.length + char.length > 12000) {
      chunks.push(part);
      part = "";
    }
    part += char;
  }
  if (part) chunks.push(part);
  return chunks;
}

export function encodeBackup(snapshot, { state = "COMPLETE" } = {}) {
  const { manifest, body } = snapshot;
  const chunks = chunksOf(JSON.stringify(body));
  return [
    [...HEADER],
    [
      "MANIFEST",
      manifest.backupId,
      FORMAT,
      "1",
      "",
      "",
      JSON.stringify(manifest),
      state,
    ],
    ...chunks.map((chunk, index) => [
      "PAYLOAD",
      manifest.backupId,
      "full",
      String(index),
      String(index + 1),
      String(chunks.length),
      chunk,
      "",
    ]),
  ];
}

export function decodeBackup(rows, { allowWriting = false } = {}) {
  try {
    if (
      !Array.isArray(rows) ||
      rows.length < 3 ||
      rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== 8 ||
          row.some((cell) => typeof cell !== "string" || cell.length >= 50000),
      )
    )
      fail();
    if (JSON.stringify(rows[0]) !== JSON.stringify(HEADER)) fail();
    const meta = rows[1],
      manifest = JSON.parse(meta[6]);
    if (
      meta[0] !== "MANIFEST" ||
      meta[1] !== manifest.backupId ||
      meta[2] !== FORMAT ||
      meta[3] !== "1" ||
      meta[4] !== "" ||
      meta[5] !== "" ||
      !(meta[7] === "COMPLETE" || (allowWriting && meta[7] === "WRITING"))
    )
      fail();
    if (
      manifest.format !== FORMAT ||
      manifest.formatVersion !== 1 ||
      manifest.schemaVersion !== 9 ||
      typeof manifest.backupId !== "string" ||
      !manifest.backupId ||
      manifest.backupId.length > 100 ||
      !Number.isFinite(new Date(manifest.createdAt).getTime())
    )
      fail();
    const parts = rows.slice(2);
    if (
      parts.some(
        (r, i) =>
          r[0] !== "PAYLOAD" ||
          r[1] !== manifest.backupId ||
          r[2] !== "full" ||
          r[3] !== String(i) ||
          r[4] !== String(i + 1) ||
          r[5] !== String(parts.length) ||
          r[7] !== "",
      )
    )
      fail();
    const payload = parts.map((r) => r[6]).join("");
    if (sha(payload) !== manifest.checksum) fail();
    const body = JSON.parse(payload);
    if (
      JSON.stringify(body.schema) !== JSON.stringify(SCHEMA) ||
      JSON.stringify(Object.keys(body.tables)) !== JSON.stringify(TABLES) ||
      JSON.stringify(Object.keys(manifest.counts)) !== JSON.stringify(TABLES)
    )
      fail();
    for (const name of TABLES) {
      const data = body.tables[name];
      if (!Array.isArray(data) || manifest.counts[name] !== data.length) fail();
      for (const row of data) {
        if (!Array.isArray(row) || row.length !== SCHEMA[name].length) fail();
        row.forEach((value, index) => {
          const column = SCHEMA[name][index];
          if (value === null) {
            if (column.notnull) fail();
            return;
          }
          if (typeof value !== "string") fail();
          if (
            column.type === "INTEGER" &&
            (!/^(0|-?[1-9][0-9]*)$/.test(value) ||
              BigInt(value) < -9223372036854775808n ||
              BigInt(value) > 9223372036854775807n)
          )
            fail();
        });
      }
    }
    return { manifest, body };
  } catch {
    return fail();
  }
}

function insertRows(db, snapshot) {
  for (const name of TABLES) {
    const columns = SCHEMA[name];
    const statement = db.prepare(
      `INSERT INTO ${name} (${columns.map((c) => c.name).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
    );
    for (const row of snapshot.body.tables[name])
      statement.run(
        ...row.map((value, index) =>
          value !== null && columns[index].type === "INTEGER"
            ? BigInt(value)
            : value,
        ),
      );
  }
  if (db.prepare("PRAGMA foreign_key_check").all().length) fail();
  if (
    db
      .prepare(
        "SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN billable_items b ON b.id=l.billable_item_id WHERE i.client_id<>b.client_id OR i.target_year<>b.target_year OR i.target_month<>b.target_month LIMIT 1",
      )
      .get()
  )
    fail();
}

export function verifyBackup(snapshot) {
  const checked = decodeBackup(encodeBackup(snapshot));
  const temp = new DatabaseSync(":memory:");
  try {
    migrateDatabase(temp, ":memory:");
    temp.exec("PRAGMA foreign_keys=ON");
    temp.exec("BEGIN");
    insertRows(temp, checked);
    temp.exec("COMMIT");
    const restored = captureBackup(temp, {
      now: new Date(checked.manifest.createdAt),
      id: checked.manifest.backupId,
    });
    if (JSON.stringify(restored) !== JSON.stringify(checked)) fail();
    return checked;
  } finally {
    temp.close();
  }
}

export function restoreBackup(db, snapshot, { expectedChecksum } = {}) {
  const checked = verifyBackup(snapshot);
  if (JSON.stringify(schemaOf(db)) !== JSON.stringify(SCHEMA)) fail();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      expectedChecksum &&
      captureBackup(db, { transaction: false }).manifest.checksum !==
        expectedChecksum
    )
      throw Object.assign(
        new Error(
          "確認後に現在のデータが変更されました。復元内容を確認し直してください。",
        ),
        { statusCode: 409 },
      );
    for (const name of [...TABLES].reverse()) db.exec(`DELETE FROM ${name}`);
    insertRows(db, checked);
    const restored = captureBackup(db, {
      transaction: false,
      now: new Date(checked.manifest.createdAt),
      id: checked.manifest.backupId,
    });
    if (JSON.stringify(restored) !== JSON.stringify(checked)) fail();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
