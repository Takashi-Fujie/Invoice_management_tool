import { test, expect } from "vitest";
import { createApp } from "../server/app.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../src/session.mjs";
import { prepareMonth, acceptAmount } from "../src/month.mjs";
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
const company = (id, amount = 10000) => ({
  id,
  name: "同名会社（架空）",
  revision: 0,
  rows: [{ id: `${id}-row`, description: "原稿制作", amount }],
  invoiced: false,
  paid: false,
});
const get = async (app, year = 2026, month = 10) =>
  (await app.inject({ url: `/api/month/${year}/${month}`, headers })).json();
const put = (app, data, year = 2026, month = 10) =>
  app.inject({
    method: "PUT",
    url: `/api/month/${year}/${month}`,
    headers,
    payload: data,
  });
test("同名の2社・同じ業務を別IDで保存し、合計・チェックを会社と月で分ける", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const a = company("a"),
      b = company("b", 24000);
    const r = await put(app, {
      companies: [{ ...a, invoiced: true, paid: true }, b],
    });
    expect(r.statusCode).toBe(200);
    const saved = r.json();
    expect(saved.companies.map((c) => c.rows[0].amount)).toEqual([
      10000, 24000,
    ]);
    expect(saved.companies.map((c) => [c.invoiced, c.paid])).toEqual([
      [true, true],
      [false, false],
    ]);
    const before = app.store.counts();
    const empty = await get(app, 2027, 1);
    expect(empty.companies.map((c) => c.rows)).toEqual([[], []]);
    expect(app.store.counts()).toEqual(before);
    const next = await put(
      app,
      {
        companies: empty.companies.map((c) =>
          c.id === "b"
            ? {
                ...c,
                visible: true,
                rows: [
                  { id: "jan-row", description: "原稿制作", amount: 5000 },
                ],
              }
            : c,
        ),
      },
      2027,
      1,
    );
    expect(next.statusCode).toBe(200);
    expect((await get(app)).companies.map((c) => c.rows[0].amount)).toEqual([
      10000, 24000,
    ]);
  } finally {
    await app.close();
  }
});
test("2社の一括保存は不正・競合で全体を戻し、会社・別月の明細ID流用を拒否", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const saved = (
      await put(app, { companies: [company("a"), company("b")] })
    ).json();
    const snapshot = await get(app);
    const changed = structuredClone(saved);
    changed.companies[0].rows[0].amount = 90000;
    changed.companies[1].rows[0].amount = -1;
    expect((await put(app, changed)).statusCode).toBe(400);
    expect(await get(app)).toEqual(snapshot);
    changed.companies[1].rows[0].amount = 20000;
    changed.companies[1].revision = 0;
    expect((await put(app, changed)).statusCode).toBe(409);
    expect(await get(app)).toEqual(snapshot);
    const hijack = structuredClone(saved);
    hijack.companies[0].rows = [];
    hijack.companies[1].rows = [saved.companies[0].rows[0]];
    expect((await put(app, hijack)).statusCode).toBe(400);
    expect(await get(app)).toEqual(snapshot);
    expect((await put(app, saved, 2026, 11)).statusCode).toBe(400);
    expect(
      (await put(app, { companies: [saved.companies[0]] })).statusCode,
    ).toBe(409);
    const duplicate = structuredClone(saved);
    duplicate.companies[1].id = duplicate.companies[0].id;
    expect((await put(app, duplicate)).statusCode).toBe(400);
    const dupRow = structuredClone(saved);
    dupRow.companies[1].rows = [dupRow.companies[0].rows[0]];
    expect((await put(app, dupRow)).statusCode).toBe(400);
    expect(await get(app)).toEqual(snapshot);
  } finally {
    await app.close();
  }
});
test("請求済明細は他社と一括でも編集を拒否し、請求→入金の制約もAPIで検証", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const saved = (
      await put(app, {
        companies: [{ ...company("a"), invoiced: true }, company("b")],
      })
    ).json();
    const changed = structuredClone(saved);
    changed.companies[0].rows[0].amount = 1;
    changed.companies[1].rows[0].amount = 2;
    expect((await put(app, changed)).statusCode).toBe(400);
    expect(await get(app)).toEqual(saved);
    changed.companies[0].invoiced = false;
    expect((await put(app, changed)).statusCode).toBe(200);
    const current = await get(app);
    current.companies[1].paid = true;
    expect((await put(app, current)).statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
test("MVP1の既存DBの全ID・金額・チェックを保持、退避・復元したDBでも複数社を保存可能", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-v1-"));
  const path = join(dir, "old.sqlite"),
    backup = join(dir, "backup.sqlite");
  let app;
  try {
    const db = new DatabaseSync(path);
    db.exec(
      readFileSync(new URL("../server/001-mvp1.sql", import.meta.url), "utf8"),
    );
    db.exec(
      "INSERT INTO clients VALUES('old','既存会社（架空）',7); INSERT INTO invoices VALUES('invoice-old','old',2026,10,32000,1,1); INSERT INTO billable_items VALUES('item-old','old',2026,10,'編集',32000); INSERT INTO invoice_lines VALUES('line-old','invoice-old','item-old',0,'編集',32000);",
    );
    db.close();
    copyFileSync(path, backup);
    app = createApp({ path });
    let saved = await get(app);
    expect(saved.companies[0]).toMatchObject({
      id: "old",
      revision: 7,
      invoiced: true,
      paid: true,
      rows: [{ id: "item-old", description: "編集", amount: 32000 }],
    });
    saved.companies.push(company("new"));
    expect((await put(app, saved)).statusCode).toBe(200);
    await app.close();
    app = null;
    const check = new DatabaseSync(path);
    expect(
      check.prepare("SELECT * FROM invoice_lines WHERE id=?").get("line-old"),
    ).toMatchObject({
      invoice_id: "invoice-old",
      billable_item_id: "item-old",
      total_yen: 32000,
    });
    expect(check.prepare("PRAGMA user_version").get().user_version).toBe(9);
    check.close();
    app = createApp({ path });
    expect((await get(app)).companies).toHaveLength(2);
    await app.close();
    app = null;
    const restored = join(dir, "restored.sqlite");
    copyFileSync(backup, restored);
    app = createApp({ path: restored });
    saved = await get(app);
    expect(saved.companies).toHaveLength(1);
    expect(saved.companies[0].rows[0].amount).toBe(32000);
    saved.companies.push(company("after-restore"));
    expect((await put(app, saved)).statusCode).toBe(200);
  } finally {
    if (app) await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("半角数字以外は金額へ読み替えず、空行は保存対象外、片方だけの入力は拒否", () => {
  for (const v of [
    "１２３",
    "abc",
    "-100",
    "+100",
    "1.5",
    "1e3",
    "1,000",
    "100円",
    " 100",
  ])
    expect(acceptAmount("12000", v)).toBe("12000");
  expect(acceptAmount("12000", "")).toBe("");
  expect(acceptAmount("", "0")).toBe("0");
  const data = {
    companies: [
      {
        ...company("a"),
        rows: [
          { id: "blank", description: "", amount: null },
          { id: "zero", description: "無償", amount: 0 },
        ],
      },
    ],
  };
  expect(prepareMonth(data).companies[0].rows).toHaveLength(1);
  expect(data.companies[0].rows).toHaveLength(2);
  data.companies[0].rows[0].description = "途中";
  expect(() => prepareMonth(data)).toThrow();
});
test("複数社の未保存月切替は確認が必要で、保存失敗は全社入力を保持し、再試行できる", async () => {
  let fail = true;
  const original = { companies: [company("a"), company("b")] };
  const calls = [];
  const s = new Session(
    {
      load: async () => structuredClone(original),
      save: async (d, y, m) => {
        calls.push([y, m]);
        if (fail) throw Error("失敗");
        return structuredClone(d);
      },
    },
    new Date(2026, 9, 31),
  );
  await s.open();
  const draft = structuredClone(s.draft);
  draft.companies[0].rows[0].amount = 500;
  draft.companies[1].paid = true;
  draft.companies[1].invoiced = true;
  s.edit(draft);
  expect(await s.switchTo(2026, 11)).toBe("confirm");
  expect(calls).toEqual([]);
  await expect(s.switchTo(2026, 11, "save")).rejects.toThrow("失敗");
  expect(s.month).toBe(10);
  expect(s.draft).toEqual(draft);
  expect(s.dirty).toBe(true);
  fail = false;
  await s.switchTo(2026, 11, "save");
  expect(calls).toEqual([
    [2026, 10],
    [2026, 10],
  ]);
  expect(s.month).toBe(11);
});

test("保存途中のDBエラーでも先の会社の更新をロールバックする", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-atomic-")),
    path = join(dir, "test.sqlite");
  const app = createApp({ path });
  try {
    const saved = (
      await put(app, { companies: [company("a"), company("b")] })
    ).json();
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER reject_test_update BEFORE UPDATE ON clients WHEN NEW.id='b' BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    db.close();
    const changed = structuredClone(saved);
    changed.companies[0].rows[0].amount = 90000;
    expect((await put(app, changed)).statusCode).toBe(500);
    expect(await get(app)).toEqual(saved);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
