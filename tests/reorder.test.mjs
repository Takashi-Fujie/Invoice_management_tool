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
import { reorderMonthRow } from "../src/detail-actions.mjs";
import { RowDragHandle } from "../src/DetailActions.tsx";
import { createApp } from "../server/app.mjs";

const row = (id, rewardType = "per_item") => ({
  id,
  description: `制作${id}（架空）`,
  amount: 100,
  rewardType,
  hours: "1",
  rate: "100",
  manualAmount: 100,
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
      name: "青葉制作（架空）",
      revision: 0,
      visible: true,
      rows: [
        row("a1"),
        row("a2", "hourly"),
        row("a3", "travel"),
        row("a4", "expense"),
        row("a5", "adjustment"),
      ],
      withholdingAmount: 12,
      invoiced: false,
      paid: false,
    },
    {
      id: "b",
      name: "若葉制作（架空）",
      revision: 0,
      visible: true,
      rows: [row("b1")],
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
const ids = (s) => s.draft.companies[0].rows.map((r) => r.id);

test("S36-T01：各タイプ・空行をIDで上下へ移動し、内容・他社・集計を保持する", () => {
  const s = session(),
    before = structuredClone(s.draft);
  const totals = companyTotals(s.draft.companies[0].rows);
  reorderMonthRow(s, "a", "a2", 0);
  expect(ids(s)).toEqual(["a2", "a1", "a3", "a4", "a5"]);
  for (const id of ["a3", "a4", "a5"])
    reorderMonthRow(
      s,
      "a",
      id,
      s.draft.companies[0].rows.findIndex((r) => r.id === id) - 1,
    );
  reorderMonthRow(s, "a", "a2", 1);
  expect(s.draft.companies[0].rows).toEqual([
    before.companies[0].rows[2],
    before.companies[0].rows[1],
    before.companies[0].rows[3],
    before.companies[0].rows[4],
    before.companies[0].rows[0],
  ]);
  expect(s.draft.companies[1]).toEqual(before.companies[1]);
  expect(s.draft.companies[0].withholdingAmount).toBe(12);
  expect(companyTotals(s.draft.companies[0].rows)).toEqual(totals);
  expect(s.base).toEqual(before);
  expect(s.dirty).toBe(true);
  s.draft.companies[0].rows.push({
    ...row("blank"),
    description: "",
    amount: null,
    hours: "",
    rate: "",
    manualAmount: null,
  });
  reorderMonthRow(s, "a", "blank", s.draft.companies[0].rows.length - 2);
  expect(ids(s).at(-2)).toBe("blank");
});

test("S36-T02：範囲外・1行は変更せず、ロック・処理中・不正対象を拒否する", () => {
  const s = session(),
    before = structuredClone(s.draft);
  reorderMonthRow(s, "a", "a1", 0);
  reorderMonthRow(s, "a", "a5", 4);
  reorderMonthRow(s, "b", "b1", 0);
  expect(s.draft).toEqual(before);
  expect(s.dirty).toBe(false);
  for (const state of [{ invoiced: true }, { paid: true }]) {
    const locked = session();
    Object.assign(locked.draft.companies[0], state);
    const original = structuredClone(locked.draft);
    expect(() => reorderMonthRow(locked, "a", "a2", 0)).toThrow(
      /請求済|入金済/,
    );
    expect(locked.draft).toEqual(original);
  }
  for (const key of ["busy", "navigating"]) {
    s[key] = true;
    expect(() => reorderMonthRow(s, "a", "a2", 0)).toThrow(/処理中/);
    s[key] = false;
  }
  for (const args of [
    ["missing", "a2", -1],
    ["a", "b1", 1],
    ["a", "a1", -1],
    ["a", "a1", 5],
    ["a", "a1", 1.5],
  ])
    expect(() => reorderMonthRow(s, ...args)).toThrow();
  expect(s.draft).toEqual(before);
});

test("S36-T02/T07：行ごとのドラッグつまみと読み上げ名、1行・ロック時の無効状態", () => {
  const render = (index, count, disabled = false) =>
    renderToStaticMarkup(
      React.createElement(RowDragHandle, {
        companyName: "青葉制作（架空）",
        index,
        count,
        disabled,
        onMove: () => {},
        onDragChange: () => {},
      }),
    );
  expect(render(1, 3)).toContain(
    'aria-label="青葉制作（架空）の2行目をドラッグして並び替え"',
  );
  expect(render(1, 3)).not.toContain('disabled=""');
  expect(render(0, 3)).not.toContain('disabled=""');
  expect(render(2, 3)).not.toContain('disabled=""');
  expect(render(0, 1)).toContain('disabled=""');
  expect(render(1, 3, true)).toContain('disabled=""');
  expect(render(1, 3)).not.toContain("上へ移動");
});

test("S36-T01：先頭から末尾・末尾から途中へ任意の距離を移し、他行の相対順序と内容を保持", () => {
  const s = session(),
    before = structuredClone(s.draft);
  reorderMonthRow(s, "a", "a1", 4);
  expect(ids(s)).toEqual(["a2", "a3", "a4", "a5", "a1"]);
  reorderMonthRow(s, "a", "a1", 1);
  expect(ids(s)).toEqual(["a2", "a1", "a3", "a4", "a5"]);
  for (const row of s.draft.companies[0].rows)
    expect(row).toEqual(before.companies[0].rows.find((r) => r.id === row.id));
});

test("S36-T03/T04：順序だけを保存し、ID・関係・他月と再起動、失敗・競合・破棄を確認", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-reorder-")),
    path = join(dir, "test.sqlite");
  let app = createApp({ path });
  const headers = {
    host: "127.0.0.1:8787",
    origin: "http://127.0.0.1:8787",
    "x-invoice-request": "1",
  };
  const api = {
    load: async (y, m) =>
      (await app.inject({ url: `/api/month/${y}/${m}`, headers })).json(),
    save: async (draft, y, m) => {
      const r = await app.inject({
        method: "PUT",
        url: `/api/month/${y}/${m}`,
        headers,
        payload: prepareMonth(draft, y, m),
      });
      if (r.statusCode !== 200) throw Error(r.json().message);
      return r.json();
    },
  };
  try {
    await api.save(data(), 2027, 1);
    const dec = await api.load(2026, 12);
    dec.companies[0].visible = true;
    dec.companies[0].rows = [row("dec")];
    await api.save(dec, 2026, 12);
    const otherMonth = await api.load(2026, 12);
    const s = new Session(api, new Date(2027, 0, 2));
    await s.open();
    const before = structuredClone(s.draft);
    const db = new DatabaseSync(path);
    const oldLines = db
      .prepare("SELECT * FROM invoice_lines ORDER BY id")
      .all();
    const items = db.prepare("SELECT * FROM billable_items ORDER BY id").all();
    reorderMonthRow(s, "a", "a2", 0);
    expect(await api.load(2027, 1)).toEqual(before);
    await s.save();
    const expected = structuredClone(s.draft);
    await s.switchTo(2026, 12);
    await s.switchTo(2027, 1);
    expect(s.draft).toEqual(expected);
    await app.close();
    app = createApp({ path });
    expect(await api.load(2027, 1)).toEqual(expected);
    expect(await api.load(2026, 12)).toEqual({
      ...otherMonth,
      companies: otherMonth.companies.map((c) => ({
        ...c,
        revision: expected.companies.find((e) => e.id === c.id).revision,
      })),
    });
    expect(
      db.prepare("SELECT * FROM billable_items ORDER BY id").all(),
    ).toEqual(items);
    for (const line of db
      .prepare("SELECT * FROM invoice_lines ORDER BY id")
      .all()) {
      const old = oldLines.find((l) => l.id === line.id);
      expect(line).toEqual({
        ...old,
        line_no:
          line.billable_item_id === "a1"
            ? 1
            : line.billable_item_id === "a2"
              ? 0
              : old.line_no,
      });
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
    reorderMonthRow(s, "a", "a2", 1);
    expect(await s.switchTo(2027, 2)).toBe("confirm");
    const draft = structuredClone(s.draft),
      save = s.api.save;
    s.api.save = async () => {
      throw Error("通信失敗");
    };
    await expect(s.save()).rejects.toThrow("通信失敗");
    expect(s.draft).toEqual(draft);
    s.api.save = save;
    await api.save(await api.load(2027, 1), 2027, 1);
    await expect(s.save()).rejects.toThrow(/別の画面/);
    expect(s.draft).toEqual(draft);
    await s.switchTo(2027, 2, "discard");
    await s.switchTo(2027, 1);
    expect(ids(s)).toEqual(["a2", "a1", "a3", "a4", "a5"]);
    s.draft.companies[0].invoiced = true;
    await s.save();
    const tampered = structuredClone(s.draft);
    tampered.companies[0].rows.reverse();
    await expect(api.save(tampered, 2027, 1)).rejects.toThrow(/請求済/);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
