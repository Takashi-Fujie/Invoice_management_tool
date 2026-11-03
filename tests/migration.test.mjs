import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.mjs";
import {
  migrateDatabase,
  databaseSnapshot,
  restoreSnapshot,
} from "../server/migrations.mjs";
function oldDb(path) {
  const db = new DatabaseSync(path);
  db.exec(
    readFileSync(new URL("../server/001-mvp1.sql", import.meta.url), "utf8"),
  );
  db.exec(
    "INSERT INTO clients VALUES('a','旧会社（架空）',7); INSERT INTO invoices VALUES('invoice-a','a',2026,10,12345,1,1); INSERT INTO billable_items VALUES('item-a','a',2026,10,'旧明細（架空）',12345); INSERT INTO invoice_lines VALUES('line-a','invoice-a','item-a',0,'旧明細（架空）',12345);",
  );
  return db;
}
test("S08-T01：移行前退避を検証し、既存全ID・金額・チェック・集計と復元を保全する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-migrate-")),
    path = join(dir, "v1.sqlite");
  let app;
  try {
    let db = oldDb(path);
    const before = databaseSnapshot(db);
    db.close();
    app = createApp({ path });
    await app.close();
    app = null;
    const backup = join(
      dir,
      readdirSync(dir).find(
        (n) => n.includes("pre-s08") && n.endsWith(".sqlite"),
      ),
    );
    expect(backup).not.toBe(path);
    db = new DatabaseSync(backup, { readOnly: true });
    expect(databaseSnapshot(db)).toEqual(before);
    db.close();
    db = new DatabaseSync(path);
    expect(db.prepare("PRAGMA user_version").get().user_version).toBe(9);
    expect(
      db
        .prepare(
          "SELECT id,client_id,target_year,target_month,description,amount_yen FROM billable_items",
        )
        .all(),
    ).toEqual(before.tables.billable_items);
    expect(
      db
        .prepare(
          "SELECT id,invoice_id,billable_item_id,line_no,description,total_yen FROM invoice_lines",
        )
        .all(),
    ).toEqual(before.tables.invoice_lines);
    expect(db.prepare("SELECT * FROM invoices").all()).toEqual(
      before.tables.invoices.map((r) => ({ ...r, withholding_yen: 0 })),
    );
    expect(db.prepare("SELECT * FROM clients").all()).toEqual(
      before.tables.clients,
    );
    expect(
      db
        .prepare("SELECT reward_type,hours_text,rate_text FROM billable_items")
        .get(),
    ).toMatchObject({ reward_type: "per_item", hours_text: "", rate_text: "" });
    db.close();
    const restored = join(dir, "restored.sqlite");
    restoreSnapshot(backup, restored);
    db = new DatabaseSync(restored, { readOnly: true });
    expect(databaseSnapshot(db)).toEqual(before);
    db.close();
    expect(() => restoreSnapshot(backup, restored)).toThrow();
    app = createApp({ path: restored });
    await app.close();
    app = null;
  } finally {
    if (app) await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("移行途中の失敗では構造と版を旧DBへ戻し、検証済み退避も保持する", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-migrate-fail-")),
    path = join(dir, "v1.sqlite");
  const db = oldDb(path);
  try {
    const before = databaseSnapshot(db);
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "exec")
          return (sql) => {
            if (sql.includes("ALTER TABLE")) {
              target.exec(
                "ALTER TABLE billable_items ADD COLUMN failure_test TEXT",
              );
              throw Error("test failure");
            }
            return target.exec(sql);
          };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(() => migrateDatabase(proxy, path)).toThrow();
    expect(databaseSnapshot(db)).toEqual(before);
    expect(
      db
        .prepare("PRAGMA table_info(billable_items)")
        .all()
        .some((c) => c.name === "failure_test"),
    ).toBe(false);
    expect(readdirSync(dir).some((n) => n.includes("pre-s08"))).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
