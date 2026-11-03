import { test, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.mjs";
import {
  databaseSnapshot,
  migrateDatabase,
  restoreSnapshot,
} from "../server/migrations.mjs";
import { Session } from "../src/session.mjs";
import { prepareMonth } from "../src/month.mjs";
import { monthSummary } from "../src/summary.mjs";
import { changeReward, defaultDiscountRate } from "../src/reward.mjs";
import {
  visibilityBlockReason,
  isCompanyVisible,
  copyPreviousVisibility,
} from "../src/company-visibility.mjs";
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const get = async (app, y = 2026, m = 11) =>
  (await app.inject({ url: `/api/month/${y}/${m}`, headers })).json();
const put = (app, data, y = 2026, m = 11) =>
  app.inject({
    method: "PUT",
    url: `/api/month/${y}/${m}`,
    headers,
    payload: data,
  });
const emptyRow = () => ({
  id: "row",
  description: "",
  amount: null,
  manualAmount: null,
  rewardType: "per_item",
  hours: "",
  rate: "",
  priceMode: "exclusive",
  feePriceMode: "exclusive",
  travelPriceMode: "inclusive",
  discountEnabled: false,
  discountRate: "2",
  withholdingEnabled: false,
});
const company = (id, extra = {}) => ({
  id,
  name: `会社${id}（架空）`,
  revision: 0,
  rows: [],
  withholdingAmount: 0,
  invoiced: false,
  paid: false,
  visible: false,
  ...extra,
});
const fee = (id = "line", amount = 1000) => ({
  ...emptyRow(),
  id,
  description: "編集（架空）",
  amount,
  priceMode: "inclusive",
  feePriceMode: "inclusive",
});

test("S31-T01：空月の初期非表示、表示だけの保存と全社非表示を月別に保持し、再起動・退避復元する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-s31-save-")),
    path = join(dir, "db.sqlite");
  let app = createApp({ path });
  try {
    let saved = (
      await put(app, {
        companies: [company("a", { visible: true }), company("b")],
      })
    ).json();
    expect(saved.companies.map((c) => c.visible)).toEqual([true, false]);
    expect(app.store.counts().invoices).toBe(0);
    const counts = app.store.counts();
    expect((await get(app, 2027, 1)).companies.map((c) => c.visible)).toEqual([
      false,
      false,
    ]);
    expect(app.store.counts()).toEqual(counts);
    saved.companies[0].visible = false;
    expect((await put(app, saved)).statusCode).toBe(200);
    const other = await get(app, 2026, 12);
    other.companies[1].visible = true;
    expect((await put(app, other, 2026, 12)).statusCode).toBe(200);
    await app.close();
    app = createApp({ path });
    expect((await get(app)).companies.map((c) => c.visible)).toEqual([
      false,
      false,
    ]);
    expect((await get(app, 2026, 12)).companies.map((c) => c.visible)).toEqual([
      false,
      true,
    ]);
    const db = new DatabaseSync(path),
      snapshot = databaseSnapshot(db),
      backup = join(dir, "backup.sqlite"),
      restored = join(dir, "restored.sqlite");
    expect(snapshot.tables.client_month_visibility).toHaveLength(4);
    db.prepare("VACUUM INTO ?").run(backup);
    db.close();
    restoreSnapshot(backup, restored);
    const copy = new DatabaseSync(restored);
    expect(databaseSnapshot(copy)).toEqual(snapshot);
    copy.close();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S31-T02：明細0円・源泉額・請求状態のある会社の非表示、不正型・省略・競合は全社拒否する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const data = {
      companies: [
        company("a", { visible: true, rows: [fee("r", 0)] }),
        company("b"),
      ],
    };
    const saved = (await put(app, data)).json();
    for (const value of [false, 0, "false", null]) {
      const bad = structuredClone(saved);
      bad.companies[0].visible = value;
      bad.companies[1].name = "変更（架空）";
      expect((await put(app, bad)).statusCode).toBe(400);
      expect(await get(app)).toEqual(saved);
    }
    expect(
      (await put(app, { companies: [saved.companies[1]] })).statusCode,
    ).toBe(409);
    expect((await put(app, saved)).statusCode).toBe(200);
    expect((await put(app, saved)).statusCode).toBe(409);
    for (const extra of [
      { withholdingAmount: 1 },
      { invoiced: true },
      { invoiced: true, paid: true },
    ]) {
      const current = await get(app);
      Object.assign(current.companies[1], extra, { visible: false });
      expect((await put(app, current)).statusCode).toBe(400);
    }
  } finally {
    await app.close();
  }
});
test("S31-T05：削除後の非表示でも他月・他社・源泉額・集計・IDを保持し、再表示で保存できる", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const previous = (
      await put(
        app,
        {
          companies: [
            company("a", {
              visible: true,
              rows: [fee()],
              withholdingAmount: 100,
            }),
            company("b"),
          ],
        },
        2026,
        10,
      )
    ).json();
    const month = await get(app);
    month.companies[1].visible = true;
    month.companies[1].rows = [fee("nov", 2000)];
    let saved = (await put(app, month)).json();
    expect(saved.companies[0].visible).toBe(false);
    const before = monthSummary(saved.companies);
    saved.companies[0].visible = true;
    const shown = (await put(app, saved)).json();
    expect(monthSummary(shown.companies)).toEqual(before);
    saved = shown;
    saved.companies[1].rows = [];
    saved.companies[1].visible = false;
    expect((await put(app, saved)).statusCode).toBe(200);
    expect(
      (await get(app, 2026, 10)).companies.map((c) => ({ ...c, revision: 0 })),
    ).toEqual(previous.companies.map((c) => ({ ...c, revision: 0 })));
    expect((await get(app, 2026, 10)).companies[0].rows[0].id).toBe("line");
  } finally {
    await app.close();
  }
});
test("S31-T02：従来形式の保存は表示設定と入力保護を維持し、非表示会社も保存前検証する", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const original = {
      companies: [company("a", { visible: true }), company("b")],
    };
    const saved = (await put(app, original)).json();
    for (const c of saved.companies) delete c.visible;
    saved.companies[1].rows = [fee()];
    const next = (await put(app, saved)).json();
    expect(next.companies.map((c) => c.visible)).toEqual([true, true]);
    const bad = structuredClone(next);
    bad.companies[0].visible = false;
    bad.companies[0].name = "";
    expect(() => prepareMonth(bad, 2026, 11)).toThrow();
  } finally {
    await app.close();
  }
});
test("S31-M03/T02：完全な空行だけを隠せ、途中入力・0円・条件変更・全タイプの明細を保護する", () => {
  const blank = company("a", { visible: true, rows: [emptyRow()] });
  expect(visibilityBlockReason(blank, 2026, 11)).toBe("");
  expect(isCompanyVisible({ ...blank, visible: false }, 2026, 11)).toBe(false);
  for (const patch of [
    { description: "入力中" },
    { amount: 0 },
    { hours: "0" },
    { manualAmount: 0 },
    { priceMode: "inclusive" },
    { withholdingEnabled: true },
    { discountEnabled: true },
    { discountRate: "1.3" },
  ]) {
    const c = { ...blank, visible: false, rows: [{ ...emptyRow(), ...patch }] };
    expect(visibilityBlockReason(c, 2026, 11)).toMatch(/明細/);
    expect(isCompanyVisible(c, 2026, 11)).toBe(true);
    expect(() => prepareMonth({ companies: [c] }, 2026, 11)).toThrow(/非表示/);
  }
  for (const rewardType of [
    "per_item",
    "hourly",
    "travel",
    "expense",
    "adjustment",
  ])
    expect(
      visibilityBlockReason(
        { ...blank, rows: [changeReward(fee(), { rewardType })] },
        2026,
        11,
      ),
    ).toMatch(/明細/);
  expect(
    visibilityBlockReason(company("b", { withholdingAmount: null }), 2026, 11),
  ).toBe("");
  expect(
    visibilityBlockReason(company("b", { withholdingAmount: "abc" }), 2026, 11),
  ).toMatch(/源泉/);
});
test("S31-M06/T03：前月のON/OFFだけをモーダル案へコピーし、当月とコピー元のデータを保護する", async () => {
  const current = {
    companies: [
      company("a"),
      company("b", { visible: true }),
      company("c", { visible: true, rows: [fee()], withholdingAmount: 100 }),
    ],
  };
  const previous = {
    companies: [
      company("a", {
        visible: true,
        rows: [fee("old")],
        invoiced: true,
        paid: true,
        withholdingAmount: 5105,
      }),
      company("b"),
      company("c"),
    ],
  };
  const before = structuredClone(previous),
    calls = [];
  const s = new Session(
    {
      load: async (y, m) => {
        calls.push([y, m]);
        return structuredClone(previous);
      },
    },
    new Date(2027, 0, 2),
  );
  s.draft = current;
  s.base = structuredClone(current);
  const result = await copyPreviousVisibility(
    s,
    structuredClone(current.companies),
  );
  expect(calls).toEqual([[2026, 12]]);
  expect(result).toMatchObject({ year: 2026, month: 12, count: 2 });
  expect(result.companies.map((c) => c.visible)).toEqual([true, false, true]);
  expect(result.companies[0]).toMatchObject({
    rows: [],
    withholdingAmount: 0,
    invoiced: false,
    paid: false,
  });
  expect(result.companies[2]).toEqual(current.companies[2]);
  expect(s.draft).toEqual(current);
  expect(s.dirty).toBe(false);
  expect(previous).toEqual(before);
});
test("S31-M06/M07：前月にない会社・前月なし・設定なしの旧月・連続コピーを扱う", async () => {
  const input = [company("new", { visible: true }), company("a"), company("b")];
  let source = { companies: [company("a", { visible: true })] };
  const s = new Session(
    { load: async () => structuredClone(source) },
    new Date(2026, 10, 1),
  );
  let result = await copyPreviousVisibility(s, input);
  expect(result.companies.map((c) => c.visible)).toEqual([false, true, false]);
  expect((await copyPreviousVisibility(s, result.companies)).companies).toEqual(
    result.companies,
  );
  source = { companies: [] };
  expect((await copyPreviousVisibility(s, input)).count).toBe(0);
  source = {
    companies: [{ ...company("b"), visible: undefined, rows: [fee()] }],
  };
  result = await copyPreviousVisibility(s, input);
  expect(result.companies.map((c) => c.visible)).toEqual([false, false, true]);
  s.year = 1;
  s.month = 1;
  await expect(copyPreviousVisibility(s, input)).rejects.toThrow(/前月/);
});
test("S31-T03：読取失敗・処理中・対象月変更で選択と入力を残し、再試行できる", async () => {
  let fail = true;
  const s = new Session(
    {
      load: async () => {
        if (fail) throw Error("読取失敗");
        return { companies: [] };
      },
    },
    new Date(2026, 10, 1),
  );
  const input = [company("a", { visible: true })],
    before = structuredClone(input),
    draft = s.draft;
  await expect(copyPreviousVisibility(s, input)).rejects.toThrow(
    /前月の読取に失敗.*選択/,
  );
  expect(input).toEqual(before);
  expect(s.draft).toBe(draft);
  expect(s.busy).toBe(false);
  fail = false;
  expect((await copyPreviousVisibility(s, input)).count).toBe(0);
  let finish;
  s.api.load = () => new Promise((resolve) => (finish = resolve));
  const pending = copyPreviousVisibility(s, input);
  expect(s.busy).toBe(true);
  await expect(copyPreviousVisibility(s, input)).rejects.toThrow(/処理中/);
  s.month = 12;
  finish({ companies: [] });
  await expect(pending).rejects.toThrow(/年月/);
  expect(input).toEqual(before);
  expect(s.draft).toBe(draft);
  expect(s.busy).toBe(false);
});
test("S31-T01/T03：保存失敗と月切替の中止・破棄・保存でも月別設定を保持する", async () => {
  let fail = true;
  const initial = { companies: [company("a")] };
  const s = new Session(
    {
      load: async () => structuredClone(initial),
      save: async (data) => {
        if (fail) throw Error("保存失敗");
        return structuredClone(data);
      },
    },
    new Date(2026, 10, 1),
  );
  await s.open();
  s.edit({ companies: [company("a", { visible: true })] });
  expect(await s.switchTo(2026, 12)).toBe("confirm");
  await expect(s.switchTo(2026, 12, "save")).rejects.toThrow();
  expect(s.month).toBe(11);
  expect(s.draft.companies[0].visible).toBe(true);
  expect(s.dirty).toBe(true);
  fail = false;
  await s.save();
  expect(s.dirty).toBe(false);
});
const files = [
  "001-mvp1.sql",
  "002-mvp2-reward.sql",
  "003-mvp2-travel.sql",
  "004-mvp2-tax.sql",
  "005-mvp2-discount.sql",
  "006-mvp2-withholding.sql",
  "007-mvp2-expense.sql",
  "008-mvp2-adjustment.sql",
];
function legacy(path, version) {
  const db = new DatabaseSync(path);
  for (const f of files.slice(0, version))
    db.exec(readFileSync(new URL("../server/" + f, import.meta.url), "utf8"));
  db.exec(
    "INSERT INTO clients VALUES('a','旧会社（架空）',7); INSERT INTO invoices(id,client_id,target_year,target_month,total_yen,invoiced,paid) VALUES('i','a',2026,10,1000,1,1); INSERT INTO billable_items(id,client_id,target_year,target_month,description,amount_yen) VALUES('r','a',2026,10,'編集（架空）',1000); INSERT INTO invoice_lines(id,invoice_id,billable_item_id,line_no,description,total_yen) VALUES('l','i','r',0,'編集（架空）',1000)",
  );
  return db;
}
for (const version of [1, 2, 3, 4, 5, 6, 7, 8])
  test(`S31-T04：版${version}→9で全旧列を保持し、退避・別DB復元・再移行する`, () => {
    const dir = mkdtempSync(join(tmpdir(), "invoice-s31-migrate-")),
      path = join(dir, "db.sqlite");
    let db = legacy(path, version);
    try {
      const before = databaseSnapshot(db),
        backup = migrateDatabase(db, path),
        after = databaseSnapshot(db);
      expect(after.version).toBe(9);
      expect(after.tables.client_month_visibility).toEqual([]);
      for (const [table, rows] of Object.entries(before.tables))
        for (const old of rows)
          expect(
            after.tables[table].find((r) => r.id === old.id),
          ).toMatchObject(old);
      if (version === 8) expect(backup).toContain("pre-s31");
      expect(migrateDatabase(db, path)).toBeNull();
      db.close();
      const target = join(dir, "restored.sqlite");
      restoreSnapshot(backup, target);
      db = new DatabaseSync(target);
      expect(databaseSnapshot(db)).toEqual(before);
      migrateDatabase(db, target);
      expect(databaseSnapshot(db)).toEqual(after);
      db.exec("PRAGMA foreign_keys=ON");
      for (const values of [
        ["missing", 2026, 11, 1],
        ["a", 0, 11, 1],
        ["a", 2026, 13, 1],
        ["a", 2026, 11, 2],
      ])
        expect(() =>
          db
            .prepare("INSERT INTO client_month_visibility VALUES(?,?,?,?)")
            .run(...values),
        ).toThrow();
      db.prepare("INSERT INTO client_month_visibility VALUES(?,?,?,?)").run(
        "a",
        2026,
        11,
        0,
      );
      expect(() =>
        db
          .prepare("INSERT INTO client_month_visibility VALUES(?,?,?,?)")
          .run("a", 2026, 11, 1),
      ).toThrow();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
test("S31-T04：新表作成後の失敗で旧構造・版・データへ戻り、検証済み退避を保持する", () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-s31-fail-")),
    path = join(dir, "db.sqlite"),
    db = legacy(path, 8);
  try {
    const before = databaseSnapshot(db);
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "exec")
          return (sql) => {
            if (sql.includes("CREATE TABLE client_month_visibility")) {
              target.exec(sql);
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
      readdirSync(dir).find((n) => n.includes("pre-s31")),
    );
    const copy = new DatabaseSync(backup);
    expect(databaseSnapshot(copy)).toEqual(before);
    copy.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
