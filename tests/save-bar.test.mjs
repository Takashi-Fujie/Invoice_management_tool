import { test, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveBar } from "../src/SaveBar.tsx";
import { Session } from "../src/session.mjs";

const render = (patch = {}) =>
  renderToStaticMarkup(
    React.createElement(SaveBar, {
      year: 2026,
      month: 11,
      dirty: false,
      ready: true,
      busy: false,
      valid: true,
      onSave: () => {},
      ...patch,
    }),
  );

test("S34-T01/T04：対象月・全社分・保存アイコンを示し、未保存を文字と状態欄で強調する", () => {
  const saved = render(),
    dirty = render({ dirty: true });
  expect(saved).toContain("2026年11月 · 全社分");
  expect(saved).toContain("保存済み");
  expect(saved).toMatch(/<button[^>]*disabled=""/);
  expect(saved).not.toContain("is-dirty");
  expect(dirty).toContain("is-dirty");
  expect(dirty).toContain("未保存の変更があります");
  expect(dirty).toContain("「変更を保存」を押して確定してください。");
  expect(dirty).toContain('role="status"');
  expect(dirty).toContain('aria-atomic="true"');
  expect(dirty).toMatch(/class="mm-save-button(?: [^"]*)?"/);
  expect(dirty).toContain("<svg");
  expect(dirty).not.toContain('disabled=""');
});

test("S34-T02：不正入力でも未保存を強調し、処理中・読取未完了・変更なしは保存不可", () => {
  const invalid = render({ dirty: true, valid: false });
  expect(invalid).toContain("is-dirty");
  expect(invalid).toContain("未保存の変更があります");
  expect(invalid).toContain("各社の業務内容");
  expect(invalid).toContain('aria-describedby="mm-save-status"');
  for (const patch of [
    { dirty: true, valid: false },
    { dirty: true, busy: true },
    { dirty: true, ready: false },
    { dirty: false },
  ])
    expect(render(patch)).toMatch(/<button[^>]*disabled=""/);
  expect(render({ dirty: true, busy: true })).toContain("処理中…");
  expect(render({ dirty: true, busy: true })).not.toContain("保存済み");
  expect(render({ ready: false })).toContain("読み込みが完了していません");
  expect(render({ ready: false })).not.toContain("保存済み");
});

test("S34-T01/T03：変更取消・保存成功だけ通常表示へ戻り、通信失敗と競合は入力と強調を保持", async () => {
  const initial = {
    companies: [{ id: "fake", name: "会社（架空）", rows: [] }],
  };
  let failure = "";
  const s = new Session({
    load: async () => structuredClone(initial),
    save: async (draft) => {
      if (failure) throw Error(failure);
      return structuredClone(draft);
    },
  });
  await s.open();
  s.edit({ companies: [] });
  expect(render({ dirty: s.dirty })).toContain("is-dirty");
  s.edit(structuredClone(initial));
  expect(render({ dirty: s.dirty })).not.toContain("is-dirty");
  s.edit({ companies: [] });
  for (const reason of ["通信失敗", "別の画面で更新されています"]) {
    failure = reason;
    const input = structuredClone(s.draft);
    await expect(s.save()).rejects.toThrow(reason);
    expect(s.draft).toEqual(input);
    expect(render({ dirty: s.dirty, busy: s.busy })).toContain("is-dirty");
  }
  failure = "";
  await s.save();
  expect(render({ dirty: s.dirty, busy: s.busy })).toContain("保存済み");
  expect(render({ dirty: s.dirty })).not.toContain("is-dirty");
});
