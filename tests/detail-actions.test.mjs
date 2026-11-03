import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Session } from "../src/session.mjs";
import { prepareMonth } from "../src/month.mjs";
import { companyTotals } from "../src/reward.mjs";
import { deleteMonthRow } from "../src/detail-actions.mjs";
import { PreviousMonthAction, DeleteRowButton } from "../src/DetailActions.tsx";
import { createApp } from "../server/app.mjs";
const row = (id, amount = 100) => ({
  id,
  description: `制作${id}（架空）`,
  amount,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "inclusive",
  feePriceMode: "inclusive",
  travelPriceMode: "inclusive",
  discountEnabled: false,
  discountRate: "2",
  withholdingEnabled: false,
});
const data = () => ({
  companies: [
    {
      id: "a",
      name: "会社A（架空）",
      revision: 0,
      rows: [row("a1"), row("a2", 200), row("a3", 300)],
      withholdingAmount: 12,
      invoiced: false,
      paid: false,
    },
    {
      id: "b",
      name: "会社B（架空）",
      revision: 0,
      rows: [row("b1", 1000)],
      withholdingAmount: 0,
      invoiced: false,
      paid: false,
    },
  ],
});
const session = () => {
  const s = new Session({}, new Date(2027, 0, 2));
  s.draft = data();
  s.base = structuredClone(s.draft);
  return s;
};
const copyHtml = (rowCount, patch = {}) =>
  renderToStaticMarkup(
    React.createElement(PreviousMonthAction, {
      rowCount,
      companyId: "a",
      companyName: "会社A（架空）",
      blocked: "",
      busy: false,
      message: "コピーしました",
      onCopy: () => {},
      ...patch,
    }),
  );
test("S30-T02/S27-T04：明細1行でもあれば空行を含めコピー欄を丸ごと非表示、0行なら表示", () => {
  expect(copyHtml(0)).toContain("前月からコピー");
  expect(copyHtml(0)).toContain("コピーしました");
  for (const count of [1, 2, 20]) expect(copyHtml(count)).toBe("");
  expect(copyHtml(0, { blocked: "請求済です", message: "" })).toMatch(
    /disabled/,
  );
  expect(copyHtml(0, { busy: true })).toMatch(/disabled/);
  const s = session();
  deleteMonthRow(s, "a", "a1");
  deleteMonthRow(s, "a", "a2");
  deleteMonthRow(s, "a", "a3");
  expect(copyHtml(s.draft.companies[0].rows.length)).toContain(
    "前月からコピー",
  );
});
test("S30-T01：指定IDだけ削除し、他社と残るID・条件・源泉額を保持し、集計を更新", () => {
  const s = session(),
    before = structuredClone(s.draft);
  deleteMonthRow(s, "a", "a2");
  expect(s.draft.companies[0].rows).toEqual([
    before.companies[0].rows[0],
    before.companies[0].rows[2],
  ]);
  expect(s.draft.companies[0].withholdingAmount).toBe(12);
  expect(s.draft.companies[1]).toEqual(before.companies[1]);
  expect(s.base).toEqual(before);
  expect(s.dirty).toBe(true);
  expect(companyTotals(s.draft.companies[0].rows).invoice).toBe(400);
  s.draft.companies[0].rows.push({
    ...row("blank"),
    description: "",
    amount: null,
  });
  deleteMonthRow(s, "a", "blank");
  expect(s.draft.companies[0].rows.map((r) => r.id)).toEqual(["a1", "a3"]);
});
test("S30-T03：請求済・入金済と処理中の削除を拒否、対象外の会社やIDでも入力を変更しない", () => {
  for (const state of [
    { invoiced: true },
    { invoiced: true, paid: true },
    { invoiced: false, paid: true },
  ]) {
    const s = session();
    Object.assign(s.draft.companies[0], state);
    const before = structuredClone(s.draft);
    expect(() => deleteMonthRow(s, "a", "a1")).toThrow(/請求済|入金済/);
    expect(s.draft).toEqual(before);
  }
  for (const key of ["busy", "navigating"]) {
    const s = session();
    s[key] = true;
    const before = structuredClone(s.draft);
    expect(() => deleteMonthRow(s, "a", "a1")).toThrow(/処理中/);
    expect(s.draft).toEqual(before);
  }
  const s = session(),
    before = structuredClone(s.draft);
  for (const [company, id] of [
    ["a", "b1"],
    ["missing", "a1"],
  ])
    expect(() => deleteMonthRow(s, company, id)).toThrow();
  expect(s.draft).toEqual(before);
});
test("S30-T06：ゴミ箱は会社・行番号の読み上げ名を持ち、編集ロック時は無効", () => {
  const render = (disabled) =>
    renderToStaticMarkup(
      React.createElement(DeleteRowButton, {
        companyName: "会社A（架空）",
        index: 1,
        disabled,
        onDelete: () => {},
      }),
    );
  expect(render(false)).toContain('aria-label="会社A（架空）の2行目を削除"');
  expect(render(false)).toContain("<svg");
  expect(render(false)).not.toContain("disabled");
  expect(render(true)).toContain("disabled");
});
const headers = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "x-invoice-request": "1",
};
function api(app) {
  return {
    load: async (y, m) =>
      (await app().inject({ url: `/api/month/${y}/${m}`, headers })).json(),
    save: async (d, y, m) => {
      const r = await app().inject({
        method: "PUT",
        url: `/api/month/${y}/${m}`,
        headers,
        payload: prepareMonth(d, y, m),
      });
      if (r.statusCode !== 200) throw Error(r.json().message);
      return r.json();
    },
  };
}
test("S30-T04：保存で削除対象と請求明細だけを除き、残るID・順序・他月を再起動後も保持", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-s30-")),
    path = join(dir, "test.sqlite");
  let app = createApp({ path });
  try {
    const service = api(() => app);
    await service.save(data(), 2027, 1);
    const otherMonth = await service.load(2026, 12);
    otherMonth.companies[0].visible = true;
    otherMonth.companies[0].rows = [row("dec-row", 500)];
    await service.save(otherMonth, 2026, 12);
    const s = new Session(service, new Date(2027, 0, 2));
    await s.open();
    const before = structuredClone(s.draft);
    const check = new DatabaseSync(path);
    const lines = check
      .prepare("SELECT * FROM invoice_lines ORDER BY id")
      .all();
    check.close();
    const counts = app.store.counts();
    deleteMonthRow(s, "a", "a2");
    expect(app.store.counts()).toEqual(counts);
    expect(await service.load(2027, 1)).toEqual(before);
    await s.save();
    const expected = structuredClone(s.draft);
    await s.switchTo(2026, 12);
    expect(s.draft.companies[0].rows[0].id).toBe("dec-row");
    await s.switchTo(2027, 1);
    expect(s.draft).toEqual(expected);
    await app.close();
    app = createApp({ path });
    expect(await service.load(2027, 1)).toEqual(expected);
    const db = new DatabaseSync(path);
    expect(
      db.prepare("SELECT id FROM billable_items WHERE id=?").get("a2"),
    ).toBeUndefined();
    expect(
      db
        .prepare("SELECT * FROM invoice_lines WHERE billable_item_id=?")
        .all("a2"),
    ).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const after = db.prepare("SELECT * FROM invoice_lines ORDER BY id").all();
    for (const old of lines.filter((l) => l.billable_item_id !== "a2"))
      expect(after.find((l) => l.id === old.id)).toMatchObject({
        ...old,
        ...(old.billable_item_id === "a3" ? { line_no: 1 } : {}),
      });
    db.close();
    deleteMonthRow(s, "a", "a1");
    deleteMonthRow(s, "a", "a3");
    await s.save();
    const emptied = await service.load(2027, 1);
    expect(emptied.companies[0].rows).toEqual([]);
    expect(emptied.companies[0].withholdingAmount).toBe(12);
    expect(emptied.companies[1].rows[0].id).toBe("b1");
    expect(copyHtml(emptied.companies[0].rows.length)).toContain(
      "前月からコピー",
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("S30-T05：削除後の中止・破棄・保存失敗・競合で入力を失わず、請求済の直接削除も拒否", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const service = api(() => app);
    await service.save(data(), 2027, 1);
    const s = new Session(service, new Date(2027, 0, 2));
    await s.open();
    deleteMonthRow(s, "a", "a2");
    expect(await s.switchTo(2027, 2)).toBe("confirm");
    expect(s.draft.companies[0].rows.map((r) => r.id)).toEqual(["a1", "a3"]);
    await s.switchTo(2027, 2, "discard");
    await s.switchTo(2027, 1);
    expect(s.draft.companies[0].rows.map((r) => r.id)).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
    deleteMonthRow(s, "a", "a2");
    const deleted = structuredClone(s.draft),
      save = s.api.save;
    s.api.save = async () => {
      throw Error("通信失敗");
    };
    await expect(s.save()).rejects.toThrow();
    expect(s.draft).toEqual(deleted);
    s.api.save = save;
    const concurrent = await service.load(2027, 1);
    await service.save(concurrent, 2027, 1);
    await expect(s.save()).rejects.toThrow(/別の画面/);
    expect(s.draft).toEqual(deleted);
    await s.switchTo(2027, 2, "discard");
    await s.switchTo(2027, 1);
    deleteMonthRow(s, "a", "a2");
    await s.save();
    s.draft.companies[0].invoiced = true;
    await s.save();
    const tampered = structuredClone(s.draft);
    tampered.companies[0].rows = [];
    await expect(service.save(tampered, 2027, 1)).rejects.toThrow(/請求済/);
  } finally {
    await app.close();
  }
});
