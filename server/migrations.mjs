import { DatabaseSync } from "node:sqlite";
import { readFileSync, copyFileSync, constants } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
const tables = [
  "clients",
  "billable_items",
  "invoices",
  "invoice_lines",
  "client_month_visibility",
];
export function databaseSnapshot(db) {
  return {
    version: db.prepare("PRAGMA user_version").get().user_version,
    tables: Object.fromEntries(
      tables
        .filter((t) =>
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(t),
        )
        .map((t) => [
          t,
          db
            .prepare(
              `SELECT * FROM ${t} ORDER BY ${t === "client_month_visibility" ? "client_id,target_year,target_month" : "id"}`,
            )
            .all(),
        ]),
    ),
  };
}
function verify(db) {
  if (
    db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    throw Error("DBの整合性を確認できません。処理を中止します。");
}
export function restoreSnapshot(backup, target) {
  const source = new DatabaseSync(backup, { readOnly: true });
  let snapshot;
  try {
    verify(source);
    snapshot = databaseSnapshot(source);
  } finally {
    source.close();
  }
  copyFileSync(backup, target, constants.COPYFILE_EXCL);
  const restored = new DatabaseSync(target, { readOnly: true });
  try {
    verify(restored);
    if (JSON.stringify(databaseSnapshot(restored)) !== JSON.stringify(snapshot))
      throw Error("復元内容が一致しません。起動を中止してください。");
  } finally {
    restored.close();
  }
}
export function migrateDatabase(db, path) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (![0, 1, 2, 3, 4, 5, 6, 7, 8, 9].includes(version))
    throw Error("対応外のDB版です。元データを変更せず終了します。");
  if (version === 9) return null;
  if (
    version === 0 &&
    db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()
      .n
  )
    throw Error("既存DBは自動変更しません。");
  const original = version > 0 ? databaseSnapshot(db) : null;
  let backupPath = null;
  if (version > 0) {
    verify(db);
    if (path !== ":memory:") {
      const before = databaseSnapshot(db);
      backupPath = `${resolve(path)}.pre-${version === 8 ? "s31" : version === 7 ? "s14" : version === 6 ? "s28" : version === 5 ? "s13" : version === 4 ? "s12" : version === 3 ? "s11" : version === 2 ? "s10" : "s08"}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.sqlite`;
      db.prepare("VACUUM INTO ?").run(backupPath);
      const copy = new DatabaseSync(backupPath, { readOnly: true });
      try {
        verify(copy);
        if (JSON.stringify(databaseSnapshot(copy)) !== JSON.stringify(before))
          throw Error(
            "移行前の退避内容が一致しません。DBを変更せず中止します。",
          );
      } finally {
        copy.close();
      }
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (version === 0)
      db.exec(readFileSync(new URL("./001-mvp1.sql", import.meta.url), "utf8"));
    if (version < 2)
      db.exec(
        readFileSync(new URL("./002-mvp2-reward.sql", import.meta.url), "utf8"),
      );
    if (version < 3)
      db.exec(
        readFileSync(new URL("./003-mvp2-travel.sql", import.meta.url), "utf8"),
      );
    if (version < 4)
      db.exec(
        readFileSync(new URL("./004-mvp2-tax.sql", import.meta.url), "utf8"),
      );
    if (version < 5)
      db.exec(
        readFileSync(
          new URL("./005-mvp2-discount.sql", import.meta.url),
          "utf8",
        ),
      );
    if (version < 6)
      db.exec(
        readFileSync(
          new URL("./006-mvp2-withholding.sql", import.meta.url),
          "utf8",
        ),
      );
    if (version < 7)
      db.exec(
        readFileSync(
          new URL("./007-mvp2-expense.sql", import.meta.url),
          "utf8",
        ),
      );
    if (version < 8)
      db.exec(
        readFileSync(
          new URL("./008-mvp2-adjustment.sql", import.meta.url),
          "utf8",
        ),
      );
    db.exec(
      readFileSync(
        new URL("./009-month-company-visibility.sql", import.meta.url),
        "utf8",
      ),
    );
    verify(db);
    if (original) {
      const migrated = databaseSnapshot(db);
      for (const table of Object.keys(original.tables)) {
        const current = new Map(
          migrated.tables[table].map((row) => [row.id, row]),
        );
        if (
          current.size !== original.tables[table].length ||
          original.tables[table].some((row) => {
            const saved = current.get(row.id);
            return (
              !saved || Object.keys(row).some((key) => saved[key] !== row[key])
            );
          })
        )
          throw Error("移行後の既存データが一致しません。");
      }
    }
    db.exec("COMMIT");
  } catch {
    db.exec("ROLLBACK");
    throw Error(
      "DB移行に失敗しました。旧構造と退避を保持して起動を中止します。",
    );
  }
  return backupPath;
}
