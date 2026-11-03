import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.mjs";
import { changeReward } from "../src/reward.mjs";
import { prepareMonth } from "../src/month.mjs";
import { Session } from "../src/session.mjs";
import {
  migrateDatabase,
  databaseSnapshot,
  restoreSnapshot,
} from "../server/migrations.mjs";
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const put = (app, data, month = 10) =>
  app.inject({
    method: "PUT",
    url: `/api/month/2026/${month}`,
    headers,
    payload: data,
  });
const get = async (app, month = 10) =>
  (await app.inject({ url: `/api/month/2026/${month}`, headers })).json();
const row = (id) => ({
  id,
  description: "報酬（架空）",
  amount: 55000,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "inclusive",
  feePriceMode: "inclusive",
  travelPriceMode: "inclusive",
  discountEnabled: false,
  discountRate: "2",
  withholdingEnabled: true,
});
const company = (id) => ({
  id,
  name: `会社${id}（架空）`,
  revision: 0,
  rows: [row("r" + id)],
  invoiced: false,
  paid: false,
  withholdingAmount: 5105,
});
test("S13-T01/T02：源泉チェックと手入力額を保存し、再起動・別月・退避復元でも小計と請求額を保持", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-withholding-")),
    path = join(dir, "db.sqlite");
  let app = createApp({ path });
  try {
    const response = await put(app, {
      companies: [company("a"), { ...company("b"), withholdingAmount: 0 }],
    });
    expect(response.statusCode).toBe(200);
    const saved = response.json();
    expect(saved.companies[0].withholdingAmount).toBe(5105);
    expect(saved.companies[0].rows[0].withholdingEnabled).toBe(true);
    await app.close();
    app = createApp({ path });
    expect(await get(app)).toEqual(saved);
    const other = await get(app, 9);
    other.companies[0].visible = true;
    other.companies[0].withholdingAmount = 7;
    expect((await put(app, other, 9)).statusCode).toBe(200);
    const back = await get(app);
    expect(back.companies[0].withholdingAmount).toBe(5105);
    expect(back.companies[1].withholdingAmount).toBe(0);
    const off = structuredClone(back);
    off.companies[0].rows[0].withholdingEnabled = false;
    const changed = (await put(app, off)).json();
    expect(changed.companies[0].withholdingAmount).toBe(5105);
    const roundTrip = changeReward(
      changeReward(row("x"), { rewardType: "travel" }),
      { rewardType: "per_item" },
    );
    expect(roundTrip.withholdingEnabled).toBe(true);
    const travel = await get(app);
    travel.companies[0].rows[0] = changeReward(travel.companies[0].rows[0], {
      rewardType: "travel",
    });
    travel.companies[0].rows[0].withholdingEnabled = true;
    expect((await put(app, travel)).statusCode).toBe(200);
    expect((await get(app)).companies[0].rows[0].withholdingEnabled).toBe(true);
    const db = new DatabaseSync(path);
    const invoice = db
      .prepare(
        "SELECT total_yen,withholding_yen FROM invoices WHERE client_id='a' AND target_month=10",
      )
      .get();
    expect(invoice).toMatchObject({ total_yen: 55000, withholding_yen: 5105 });
    expect(invoice.total_yen - invoice.withholding_yen).toBe(49895);
    expect(
      db
        .prepare(
          "SELECT withholding_enabled FROM invoice_lines WHERE billable_item_id='ra'",
        )
        .get().withholding_enabled,
    ).toBe(1);
    const snap = databaseSnapshot(db),
      backup = join(dir, "saved.sqlite"),
      restore = join(dir, "restored.sqlite");
    db.prepare("VACUUM INTO ?").run(backup);
    db.close();
    restoreSnapshot(backup, restore);
    const copy = new DatabaseSync(restore);
    expect(databaseSnapshot(copy)).toEqual(snap);
    copy.close();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S13-T02：空欄は保存時0円、源泉条件だけの空明細は保存せず会社・月の手入力は保持", async () => {
  const data = { companies: [company("a")] };
  data.companies[0].withholdingAmount = null;
  expect(prepareMonth(data, 2026, 10).companies[0].withholdingAmount).toBe(0);
  const app = createApp({ path: ":memory:" });
  try {
    let saved = (
      await put(app, {
        companies: [{ ...company("a"), rows: [], withholdingAmount: 100 }],
      })
    ).json();
    expect(saved.companies[0].withholdingAmount).toBe(100);
    expect(saved.companies[0].rows).toEqual([]);
    const draft = {
      companies: [
        {
          ...company("b"),
          withholdingAmount: 0,
          rows: [
            {
              ...row("empty"),
              description: "",
              amount: null,
              withholdingEnabled: true,
            },
          ],
        },
      ],
    };
    expect(prepareMonth(draft, 2026, 10).companies[0].rows).toEqual([]);
    saved.companies[0].withholdingAmount = 999999999;
    expect((await put(app, saved)).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
test("S13-T03：不正な源泉額・チェック・請求済変更と競合を全社拒否し、解除後に訂正できる", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    let saved = (
      await put(app, { companies: [company("a"), company("b")] })
    ).json();
    for (const value of [-1, 1.5, "100", null, 1000000000]) {
      const bad = structuredClone(saved);
      bad.companies[0].name = "変更（架空）";
      bad.companies[1].withholdingAmount = value;
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    for (const value of [1, "true", null]) {
      const bad = structuredClone(saved);
      bad.companies[1].rows[0].withholdingEnabled = value;
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    saved.companies[0].invoiced = true;
    saved = (await put(app, saved)).json();
    for (const change of [
      (c) => (c.withholdingAmount = 0),
      (c) => (c.rows[0].withholdingEnabled = false),
    ]) {
      const bad = structuredClone(saved);
      change(bad.companies[0]);
      bad.companies[1].name = "変更（架空）";
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    const unlock = structuredClone(saved);
    unlock.companies[0].invoiced = false;
    unlock.companies[0].withholdingAmount = 0;
    expect((await put(app, unlock)).statusCode).toBe(200);
    expect((await put(app, saved)).statusCode).toBe(409);
  } finally {
    await app.close();
  }
});
test("S13-T03：通信失敗後も源泉チェックと手入力額を保持し再保存できる", async () => {
  let fail = true;
  const initial = { companies: [company("a")] };
  const session = new Session(
    {
      load: async () => structuredClone(initial),
      save: async (d) => {
        if (fail) throw Error("通信失敗");
        return structuredClone(d);
      },
    },
    new Date(2026, 9, 1),
  );
  await session.open();
  const draft = structuredClone(session.draft);
  draft.companies[0].withholdingAmount = 1234;
  draft.companies[0].rows[0].withholdingEnabled = false;
  session.edit(draft);
  await expect(session.save()).rejects.toThrow();
  expect(session.draft).toEqual(draft);
  fail = false;
  await session.save();
  expect(session.draft).toEqual(draft);
  expect(session.dirty).toBe(false);
});
const files = [
  "001-mvp1.sql",
  "002-mvp2-reward.sql",
  "003-mvp2-travel.sql",
  "004-mvp2-tax.sql",
  "005-mvp2-discount.sql",
];
function legacy(path, version) {
  const db = new DatabaseSync(path);
  for (const file of files.slice(0, version))
    db.exec(
      readFileSync(new URL("../server/" + file, import.meta.url), "utf8"),
    );
  db.exec(
    "INSERT INTO clients VALUES('a','移行（架空）',7); INSERT INTO invoices VALUES('i','a',2026,10,55000,1,1); INSERT INTO billable_items(id,client_id,target_year,target_month,description,amount_yen) VALUES('r','a',2026,10,'報酬（架空）',55000); INSERT INTO invoice_lines(id,invoice_id,billable_item_id,line_no,description,total_yen) VALUES('l','i','r',0,'報酬（架空）',55000);",
  );
  return db;
}
for (const version of [1, 2, 3, 4, 5])
  test(`S13-T04：版${version}→9で全旧列を保持し、退避復元・再移行・重複適用防止`, () => {
    const dir = mkdtempSync(join(tmpdir(), "invoice-withholding-migrate-")),
      path = join(dir, "db.sqlite");
    let db = legacy(path, version);
    try {
      const before = databaseSnapshot(db),
        backup = migrateDatabase(db, path),
        after = databaseSnapshot(db);
      expect(after.version).toBe(9);
      for (const [table, rows] of Object.entries(before.tables)) {
        const cols = Object.keys(rows[0] || {});
        expect(
          after.tables[table].map((r) =>
            Object.fromEntries(cols.map((k) => [k, r[k]])),
          ),
        ).toEqual(rows);
      }
      expect(after.tables.invoices[0].withholding_yen).toBe(0);
      for (const t of ["billable_items", "invoice_lines"])
        expect(after.tables[t][0].withholding_enabled).toBe(0);
      if (version === 5) expect(backup).toContain("pre-s13");
      expect(migrateDatabase(db, path)).toBeNull();
      db.close();
      const restored = join(dir, "restored.sqlite");
      restoreSnapshot(backup, restored);
      db = new DatabaseSync(restored);
      expect(databaseSnapshot(db)).toEqual(before);
      migrateDatabase(db, restored);
      expect(databaseSnapshot(db)).toEqual(after);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
test("S13-T04：源泉列の移行途中の失敗は構造・版・データを戻して退避を保持", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-withholding-fail-")),
    path = join(dir, "db.sqlite"),
    db = legacy(path, 5);
  try {
    const before = databaseSnapshot(db);
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "exec")
          return (sql) => {
            if (sql.includes("ADD COLUMN withholding_enabled")) {
              target.exec(
                "ALTER TABLE billable_items ADD COLUMN withholding_enabled INTEGER",
              );
              throw Error("failure");
            }
            return target.exec(sql);
          };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(() => migrateDatabase(proxy, path)).toThrow();
    expect(databaseSnapshot(db)).toEqual(before);
    const backup = join(
      dir,
      readdirSync(dir).find((n) => n.includes("pre-s13")),
    );
    const copy = new DatabaseSync(backup);
    expect(databaseSnapshot(copy)).toEqual(before);
    copy.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
