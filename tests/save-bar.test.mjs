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
      saving: false,
      saveError: "",
      onRetry: () => {},
      ...patch,
    }),
  );

test("S34-T01/T04・S37-T08：対象月・全社分・自動保存状態を示し通常保存ボタンを置かない", () => {
  const saved = render(),
    dirty = render({ dirty: true });
  expect(saved).toContain("2026年11月 · 全社分");
  expect(saved).toContain("保存済み");
  expect(saved).not.toContain("<button");
  expect(saved).not.toContain("is-dirty");
  expect(dirty).toContain("is-dirty");
  expect(dirty).toContain("自動保存待ち");
  expect(dirty).toContain("入力が止まると自動保存します。");
  expect(dirty).toContain('role="status"');
  expect(dirty).toContain('aria-atomic="true"');
  expect(dirty).not.toContain("<button");
  expect(dirty).not.toContain('disabled=""');
});

test("S34-T02：不正入力でも未保存を強調し、処理中・読取未完了・変更なしは保存不可", () => {
  const invalid = render({ dirty: true, valid: false });
  expect(invalid).toContain("is-dirty");
  expect(invalid).toContain("入力を確認してください");
  expect(invalid).toContain("各社の業務内容");

  for (const patch of [
    { dirty: true, valid: false },
    { dirty: true, busy: true },
    { dirty: true, ready: false },
    { dirty: false },
  ])
    expect(render(patch)).not.toContain("<button");
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

test("S37-T04/T08：保存中・失敗を区別し、失敗時だけ再試行を示す", () => {
  const saving = render({ dirty: true, saving: true });
  expect(saving).toContain("保存中…");
  expect(saving).not.toContain("保存済み");
  const failed = render({ dirty: true, saveError: "通信失敗" });
  expect(failed).toContain("自動保存に失敗しました");
  expect(failed).toContain("通信失敗");
  expect(failed).toContain("再試行");
  expect(failed).not.toContain("変更を保存");
  expect(failed).not.toContain("保存済み");
});
