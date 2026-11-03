// 画面モックのメモリ内操作を検証。本番のDB保存・受入試験とは別。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function model() {
  const html = fs.readFileSync(__dirname + '/monthly-entry.html', 'utf8');
  const core = html.match(/<script data-mock-core>([\s\S]*?)<\/script>/)[1];
  return vm.runInNewContext(core + '\ncreateMonthlyMock', { Date, JSON })(new Date(2026, 9, 31));
}
function keyboardHandler(confirm) {
  const html = fs.readFileSync(__dirname + '/monthly-entry.html', 'utf8');
  const core = html.match(/<script data-mock-core>([\s\S]*?)<\/script>/)[1];
  return vm.runInNewContext(core + '\ncreateMockFormKeyboardHandler', { Date, JSON })(confirm);
}
test('日本語変換中のEnterでは追加・検証・フォーカス移動を呼び出さない', () => {
  let confirmed = 0, prevented = 0;
  const h = keyboardHandler(() => confirmed++);
  const enter = extra => ({ key: 'Enter', preventDefault: () => prevented++, ...extra });
  h.compositionstart();
  h.keydown(enter({ isComposing: true }));
  h.keydown(enter({ isComposing: false }));
  h.compositionend();
  // Safari等でisComposingがfalseでもIME入力のキーを判別する。
  h.keydown(enter({ isComposing: false, keyCode: 229 }));
  h.keydown(enter({ isComposing: true }));
  assert.equal(confirmed, 0);
  assert.equal(prevented, 0);
  h.keydown(enter({ isComposing: false, keyCode: 13 }));
  assert.equal(confirmed, 1);
  assert.equal(prevented, 1);
});
test('IME状態はフォームごとに独立し、通常の入力キーでは確定処理を呼ばない', () => {
  let a = 0, b = 0;
  const first = keyboardHandler(() => a++), second = keyboardHandler(() => b++);
  first.compositionstart();
  second.keydown({ key: 'Enter', preventDefault() {} });
  first.keydown({ key: 'a', preventDefault() { throw Error('通常入力を妨げない'); } });
  assert.equal(a, 0); assert.equal(b, 1);
});
test('直接入力の整数は受け付け、空欄・小数・指数表記を整数へ読み替えない', () => {
  const html = fs.readFileSync(__dirname + '/monthly-entry.html', 'utf8');
  const core = html.match(/<script data-mock-core>([\s\S]*?)<\/script>/)[1];
  const parse = vm.runInNewContext(core + '\nparseMockInteger', { Date, JSON });
  assert.equal(parse('2026'), 2026);
  assert.equal(parse('80000'), 80000);
  assert.equal(parse('0'), 0);
  for (const invalid of ['', '1.5', '1e3', '-1', 'abc']) assert.equal(parse(invalid), null);
});
test('当日の年月で開始し、業務内容と報酬だけで明細を追加できる', () => {
  const m = model(); assert.equal(m.key(), '2026-10');
  const before = m.total(); m.add('取材・原稿作成', 12000);
  assert.equal(m.total(), before + 12000); assert.equal(m.key(), '2026-10'); assert.equal(m.dirty(), true);
});
test('未保存での切替を保留し、保存後に別月へ移動して元月を復元', () => {
  const m = model(); m.add('記事の編集', 5000); const total = m.total();
  assert.equal(m.switchTo(2026, 11), 'confirm'); assert.equal(m.key(), '2026-10');
  m.save(); assert.equal(m.switchTo(2026, 11), 'changed'); assert.equal(m.total(), 0);
  m.switchTo(2026, 10); assert.equal(m.total(), total);
});
test('破棄は未保存分のみ破棄し、保存済みの元月と会社を保持', () => {
  const m = model(); const total = m.total(); const company = m.draft.company;
  m.add('未保存の業務', 1000); m.switchTo(2026, 11, true); m.switchTo(2026, 10);
  assert.equal(m.total(), total); assert.equal(m.draft.company, company);
});
test('請求済から入金済へ進み、保存して戻るとチェックが保持される', () => {
  const m = model(); m.setCheck('paid',true); assert.equal(m.draft.paid,false);
  m.setCheck('invoiced',true);m.setCheck('paid',true);m.setCheck('invoiced',false);
  assert.equal(m.draft.invoiced,true);
  m.save(); m.switchTo(2026, 11); m.switchTo(2026, 10);
  assert.equal(m.draft.paid, true); assert.equal(m.draft.invoiced, true);
});
test('年またぎと空月：月を開くだけでは保存レコードを作らない', () => {
  const m = model(); m.switchTo(2026, 12); const count = Object.keys(m.saved).length;
  const next = m.adjacent(1); assert.equal(next.year, 2027); assert.equal(next.month, 1);
  m.switchTo(next.year, next.month); assert.equal(Object.keys(m.saved).length, count);
});
test('不正な年月・金額を保存せず、編集内容を維持する', () => {
  const m = model(); assert.throws(() => m.switchTo(2026, 13));
  assert.throws(() => m.add('作業', 1.5));
  assert.throws(() => m.add('作業', -1));
  assert.equal(m.key(), '2026-10');
});
test('案件や業務タイプを要求せず、同名の業務も別明細として登録できる', () => {
  const m = model(); const count = m.draft.rows.length;
  m.add('原稿作成', 10000); m.add('原稿作成', 20000);
  assert.equal(m.draft.rows.length, count + 2);
  assert.equal(m.draft.rows.at(-1).description, '原稿作成');
  assert.equal(m.draft.rows.at(-1).amount, 20000);
  assert.equal('projects' in m.draft, false);
  assert.equal('project' in m.draft.rows.at(-1), false);
  assert.throws(() => m.add('   ', 10000));
});
