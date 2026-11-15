import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase } from "../server/migrations.mjs";
import {
  captureBackup,
  encodeBackup,
  decodeBackup,
  restoreBackup,
  backupTitle,
} from "../server/backup.mjs";
import { GoogleSheetsBackup } from "../server/google-sheets.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  migrateDatabase(db, ":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.prepare("INSERT INTO clients VALUES(?,?,?)").run("z", "架空会社Z", 3);
  db.prepare("INSERT INTO clients VALUES(?,?,?)").run("a", "架空会社A", 0);
  const description = "=架空の入力\n改行・絵文字😀" + "長文".repeat(40000);
  db.prepare(
    "INSERT INTO billable_items(id,client_id,target_year,target_month,description,amount_yen,hours_text,rate_text,manual_amount_yen) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run("item", "z", 2025, 12, description, 100, "1.250", "80.00", null);
  db.prepare(
    "INSERT INTO invoices(id,client_id,target_year,target_month,total_yen,invoiced,paid,withholding_yen) VALUES(?,?,?,?,?,?,?,?)",
  ).run("invoice", "z", 2025, 12, 100, 1, 1, 10);
  db.prepare(
    "INSERT INTO invoice_lines(id,invoice_id,billable_item_id,line_no,description,total_yen) VALUES(?,?,?,?,?,?)",
  ).run("line", "invoice", "item", 1, description, 100);
  db.prepare(
    "INSERT INTO client_month_visibility VALUES(?,?,?,?,?)".replace(
      "?,?,?,?,?",
      "?,?,?,?",
    ),
  ).run("z", 2026, 1, 1);
  return db;
}
const fixed = { now: new Date("2026-11-03T03:30:00Z"), id: "test-backup" };

test("S20-T01：日本時間の分までの名前と、全会社・全年月を含む1タブの完全復元", () => {
  const source = fixture(),
    target = new DatabaseSync(":memory:");
  migrateDatabase(target, ":memory:");
  target.exec("PRAGMA foreign_keys=ON");
  try {
    const original = captureBackup(source, fixed);
    expect(backupTitle(original.manifest.createdAt)).toBe(
      "請求管理ツール_バックアップ_202611031230",
    );
    const cells = encodeBackup(original);
    expect(
      cells.every(
        (row) =>
          row.length === 8 && row.every((cell) => typeof cell === "string"),
      ),
    ).toBe(true);
    expect(cells.every((row) => row.every((cell) => cell.length < 50000))).toBe(
      true,
    );
    const decoded = decodeBackup(JSON.parse(JSON.stringify(cells)));
    restoreBackup(target, decoded);
    expect(captureBackup(target, fixed)).toEqual(original);
    expect(
      target
        .prepare("SELECT id FROM clients ORDER BY rowid")
        .all()
        .map((row) => row.id),
    ).toEqual(["z", "a"]);
    expect(
      target
        .prepare(
          "SELECT manual_amount_yen,hours_text,rate_text FROM billable_items",
        )
        .get(),
    ).toEqual({
      manual_amount_yen: null,
      hours_text: "1.250",
      rate_text: "80.00",
    });
  } finally {
    source.close();
    target.close();
  }
});

test("S20-T02：空DBとSQLiteの大きい整数も欠落・丸めなしで復元する", () => {
  const db = new DatabaseSync(":memory:"),
    target = new DatabaseSync(":memory:");
  migrateDatabase(db, ":memory:");
  migrateDatabase(target, ":memory:");
  try {
    expect(
      decodeBackup(encodeBackup(captureBackup(db, fixed))).manifest.counts
        .clients,
    ).toBe(0);
    db.prepare("INSERT INTO clients VALUES('big','架空',?)").run(
      9223372036854775807n,
    );
    const snapshot = decodeBackup(encodeBackup(captureBackup(db, fixed)));
    restoreBackup(target, snapshot);
    expect(captureBackup(target, fixed)).toEqual(captureBackup(db, fixed));
  } finally {
    db.close();
    target.close();
  }
});

test.each(["未完了", "欠落", "改変", "重複", "版違い"])(
  "S20-T03：%sのバックアップを拒否する",
  (kind) => {
    const db = fixture();
    try {
      const cells = encodeBackup(captureBackup(db, fixed));
      if (kind === "未完了") cells[1][7] = "WRITING";
      if (kind === "欠落") cells.pop();
      if (kind === "改変") cells[2][6] += "x";
      if (kind === "重複") cells.push(cells[2]);
      if (kind === "版違い") {
        const m = JSON.parse(cells[1][6]);
        m.formatVersion = 999;
        cells[1][6] = JSON.stringify(m);
      }
      expect(() => decodeBackup(cells)).toThrow();
    } finally {
      db.close();
    }
  },
);

test("S20-T04：制約違反や列不足を含む復元では元DBを変更しない", () => {
  const db = fixture();
  try {
    const before = captureBackup(db, fixed);
    const invalid = structuredClone(before);
    invalid.body.tables.invoice_lines[0][1] = "存在しない請求";
    expect(() => restoreBackup(db, invalid)).toThrow();
    expect(captureBackup(db, fixed)).toEqual(before);
    const missing = structuredClone(before);
    missing.body.schema.clients.pop();
    expect(() => restoreBackup(db, missing)).toThrow();
    expect(captureBackup(db, fixed)).toEqual(before);
  } finally {
    db.close();
  }
});

test("S20-T04：復元中のDBエラーでも全件ロールバックする", () => {
  const db = fixture();
  try {
    const before = captureBackup(db, fixed);
    db.exec(
      "CREATE TRIGGER fail_restore BEFORE INSERT ON invoice_lines BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    expect(() => restoreBackup(db, before)).toThrow();
    expect(captureBackup(db, fixed)).toEqual(before);
  } finally {
    db.close();
  }
});

test("S20-T04：復元後の全件不一致もコミット前に検出して元DBへ戻す", () => {
  const db = fixture();
  try {
    const before = captureBackup(db, fixed);
    db.exec(
      "CREATE TRIGGER alter_restore AFTER INSERT ON clients BEGIN UPDATE clients SET name='意図しない変更' WHERE id=NEW.id; END",
    );
    expect(() => restoreBackup(db, before)).toThrow();
    expect(captureBackup(db, fixed)).toEqual(before);
  } finally {
    db.close();
  }
});

function googleStub() {
  const tabs = [
    {
      properties: {
        sheetId: 0,
        title: "既存タブ",
        gridProperties: { rowCount: 1000, columnCount: 26 },
      },
    },
  ];
  let cells = [],
    failRead = false;
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const body = options.body ? JSON.parse(options.body) : null;
    if (String(url).includes(":batchUpdate")) {
      const replies = [];
      if (body.requests[0]?.addSheet) {
        const properties = {
          ...body.requests[0].addSheet.properties,
          sheetId: 44,
        };
        tabs.push({ properties });
        replies.push({ addSheet: { properties } });
      }
      for (const request of body.requests)
        if (request.updateCells) {
          const { start, rows } = request.updateCells;
          rows.forEach((r, i) => {
            cells[start.rowIndex + i] = r.values.map(
              (v) => v.userEnteredValue.stringValue,
            );
          });
        }
      return Response.json({ replies });
    }
    if (String(url).includes("includeGridData=true")) {
      if (failRead) return new Response("failure", { status: 503 });
      return Response.json({
        sheets: [
          {
            data: [
              {
                rowData: cells.map((row) => ({
                  values: row.map((value) => ({
                    userEnteredValue: { stringValue: value },
                  })),
                })),
              },
            ],
          },
        ],
      });
    }
    return Response.json({ sheets: tabs });
  };
  return {
    tabs,
    calls,
    fetcher,
    get cells() {
      return cells;
    },
    setFailRead() {
      failRead = true;
    },
    clearFailure() {
      failRead = false;
    },
    truncate() {
      cells = cells.slice(0, 3);
    },
  };
}

test("S20-T05：指定ファイルへ新規1タブだけを作り、文字列として書出し・読戻し後に完了する", async () => {
  const db = fixture(),
    fake = googleStub();
  try {
    const client = new GoogleSheetsBackup({
      getAccessToken: async () => "test-token",
      fetcher: fake.fetcher,
    });
    const backup = captureBackup(db, fixed);
    const result = await client.upload(
      "https://docs.google.com/spreadsheets/d/test-spreadsheet/edit#gid=0",
      backup,
    );
    expect(result.title).toBe(backupTitle(backup.manifest.createdAt));
    expect(fake.tabs).toHaveLength(2);
    expect(fake.tabs[0].properties.title).toBe("既存タブ");
    expect(decodeBackup(fake.cells)).toEqual(backup);
    expect(
      fake.calls.every(({ url }) =>
        url.startsWith(
          "https://sheets.googleapis.com/v4/spreadsheets/test-spreadsheet",
        ),
      ),
    ).toBe(true);
    const previous = JSON.stringify(fake.cells);
    await expect(
      client.upload(
        "test-spreadsheet",
        captureBackup(db, { ...fixed, id: "another" }),
      ),
    ).rejects.toThrow(/同じ日時/);
    expect(JSON.stringify(fake.cells)).toBe(previous);
  } finally {
    db.close();
  }
});

test("S20-T06：通信失敗した世代を完了扱いにせず、同じ処理の再試行で復旧する", async () => {
  const db = fixture(),
    fake = googleStub();
  const client = new GoogleSheetsBackup({
    getAccessToken: async () => "test-token",
    fetcher: fake.fetcher,
  });
  try {
    fake.setFailRead();
    await expect(
      client.upload("test-spreadsheet", captureBackup(db, fixed)),
    ).rejects.toThrow();
    expect(fake.cells[1][7]).toBe("WRITING");
    fake.clearFailure();
    fake.truncate();
    await client.upload("test-spreadsheet", captureBackup(db, fixed));
    expect(fake.tabs).toHaveLength(2);
    expect(decodeBackup(fake.cells)).toEqual(captureBackup(db, fixed));
  } finally {
    db.close();
  }
});

test("S20-T07：任意URL・数式入りセル・管理外タブを復元元に使わない", async () => {
  const fake = googleStub(),
    client = new GoogleSheetsBackup({
      getAccessToken: async () => "test-token",
      fetcher: fake.fetcher,
    });
  await expect(
    client.upload("https://evil.example/spreadsheets/d/test", {}),
  ).rejects.toThrow();
  await expect(client.download("test-spreadsheet", 0)).rejects.toThrow();
});

test("S20-T11：多数の世代はまとめて読み、未完了タブを復元候補から外す", async () => {
  const db = fixture(),
    sheets = [];
  let reads = 0;
  try {
    for (let index = 0; index < 65; index++) {
      const snapshot = captureBackup(db, {
        now: new Date(Date.parse(fixed.now) + index * 60000),
        id: `backup-${index}`,
      });
      sheets.push({
        properties: {
          sheetId: index + 1,
          title: backupTitle(snapshot.manifest.createdAt),
        },
        data: [
          {
            rowData: encodeBackup(snapshot, {
              state: index === 64 ? "WRITING" : "COMPLETE",
            })
              .slice(0, 2)
              .map((row) => ({
                values: row.map((value) => ({
                  userEnteredValue: { stringValue: value },
                })),
              })),
          },
        ],
      });
    }
    const client = new GoogleSheetsBackup({
      getAccessToken: async () => "test",
      fetcher: async (url) => {
        if (String(url).includes("includeGridData=true")) {
          reads++;
          const ranges = new URL(url).searchParams.getAll("ranges");
          return Response.json({
            sheets: sheets.filter((s) =>
              ranges.some((range) => range.includes(s.properties.title)),
            ),
          });
        }
        return Response.json({
          sheets: sheets.map(({ properties }) => ({ properties })),
        });
      },
    });
    const result = await client.list("test-spreadsheet");
    expect(result).toHaveLength(64);
    expect(reads).toBeLessThan(10);
  } finally {
    db.close();
  }
});
