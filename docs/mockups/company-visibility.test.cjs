const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const blue = '青葉編集室（架空）', green = 'こもれび企画（架空）', quiet = 'みなと制作（架空）';
function screen(today = '2026-11-02T12:00:00+09:00') {
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attrs = {}; this.value = ''; this.textContent = ''; this.open = false; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(k, v) { this.attrs[k] = v; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {}
    reportValidity() { return !!this.value.trim(); }
  }
  const html = fs.readFileSync(__dirname + '/company-visibility.html', 'utf8');
  const ids = Object.fromEntries([...html.matchAll(/id="(mc-[^"]+)"/g)].map(m => [m[1], new Element()]));
  const root = { querySelector: selector => ids[selector.slice(1)] };
  const Clock = class extends Date { constructor(...args) { super(...(args.length ? args : [today])); } };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { document: { getElementById: () => root, createElement: tag => new Element(tag) }, Date: Clock });
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const find = label => Object.values(ids).flatMap(descendants).find(n => n.attrs['aria-label'] === label);
  const click = id => ids[id].onclick();
  return {
    find, ids, manage: () => click('mc-add-company'), apply: () => click('mc-apply'), cancel: () => click('mc-cancel'),
    copy: () => click('mc-copy-visibility'), next: () => click('mc-next'), prev: () => click('mc-prev'), save: () => click('mc-save'),
    discard: () => click('mc-switch-discard'), stay: () => click('mc-switch-cancel'), saveAndSwitch: () => click('mc-switch-save'),
    visible: name => find(`${name}のこの月に表示`), cards: () => ids['mc-list'].children.filter(n => n.tagName === 'section'),
    toggle(name, value) { const input = find(`${name}のこの月に表示`); input.checked = value; input.onchange(); },
    add(name) { ids['mc-name'].value = name; click('mc-confirm'); },
    change(label, value, event = 'oninput') { const input = find(label); assert.ok(input, label); input.value = value; input[event](); },
  };
}
function show(s, names = [blue, green]) { s.manage(); for (const name of names) s.toggle(name, true); s.apply(); }
test('S31-M01：明細も設定もない月は全社非表示で、読取だけでは未保存にならない', () => {
  const s = screen(); assert.equal(s.cards().length, 0); assert.match(s.ids['mc-list'].children[0].textContent, /この月に表示する会社はありません/);
  assert.match(s.ids['mc-save-status'].textContent, /^保存済み/); assert.equal(s.ids['mc-save'].disabled, true);
  s.manage(); for (const name of [blue, green, quiet]) { assert.equal(s.visible(name).checked, false); assert.equal(s.visible(name).disabled, false); }
  s.cancel(); assert.equal(s.cards().length, 0);
});
test('S31-M02/M05：同じモーダルで表示切替と会社追加を反映し、キャンセルは元入力を保持する', () => {
  const s = screen(); s.manage(); s.toggle(blue, true); s.add('追加会社（架空）'); assert.equal(s.visible('追加会社（架空）').checked, true); s.cancel();
  assert.equal(s.cards().length, 0); s.manage(); assert.equal(s.visible('追加会社（架空）'), undefined); s.toggle(blue, true); s.add('追加会社（架空）'); s.apply();
  assert.equal(s.cards().length, 2); assert.equal(s.find('追加会社（架空）の1行目の業務内容').value, '');
  s.change(`${blue}の1行目の業務内容`, '未保存の記事'); s.manage(); s.toggle('追加会社（架空）', false); s.cancel();
  assert.equal(s.cards().length, 2); assert.equal(s.find(`${blue}の1行目の業務内容`).value, '未保存の記事');
});
test('S31-M03：0円・途中入力・変更した条件があれば非表示を拒否し、完全な空行だけは隠せる', () => {
  for (const [field, value, event] of [['業務内容', '入力途中', 'oninput'], ['報酬額（円）', '0', 'oninput'], ['税込／税抜', 'inclusive', 'onchange']]) {
    const s = screen(); show(s, [blue]); s.change(`${blue}の1行目の${field}`, value, event); s.manage();
    assert.equal(s.visible(blue).disabled, true, field); s.toggle(blue, false); assert.equal(s.visible(blue).checked, true); s.apply(); assert.equal(s.cards().length, 1);
  }
  const s = screen(); show(s, [blue]); s.manage(); s.toggle(blue, false); s.apply(); assert.equal(s.cards().length, 0);
  show(s, [blue]); assert.equal(s.find(`${blue}の1行目の業務内容`).value, '');
});
test('S31-M04：源泉額だけ・請求済・入金済でも非表示を拒否する', () => {
  for (const state of ['源泉額', '請求済', '入金済']) {
    const s = screen(); show(s, [blue]);
    if (state === '源泉額') s.change(`${blue}の源泉徴収額`, '123');
    else { let input = s.find(`${blue}の請求済`); input.checked = true; input.onchange(); if (state === '入金済') { input = s.find(`${blue}の入金済`); input.checked = true; input.onchange(); } }
    s.manage(); assert.equal(s.visible(blue).disabled, true, state); s.toggle(blue, false); assert.equal(s.visible(blue).checked, true);
  }
});
test('S31-M06：前月のON/OFFだけをコピーし、明細・金額・源泉・請求状態をコピーしない', () => {
  const s = screen(); s.manage(); s.copy(); assert.equal(s.visible(blue).checked, true); assert.equal(s.visible(green).checked, true); assert.equal(s.visible(quiet).checked, false);
  s.copy(); s.apply(); assert.equal(s.cards().length, 2); assert.equal(s.find(`${blue}の1行目の業務内容`).value, ''); assert.equal(s.find(`${blue}の源泉徴収額`).value, '0');
  assert.equal(s.find(`${blue}の請求済`).checked, false); assert.match(s.ids['mc-copy-result'].textContent, /2026年10月/);
  s.save(); s.prev(); assert.equal(s.find(`${blue}の1行目の報酬額（円）`).value, '50,000');
});
test('S31-M06：前月OFFの会社を当月で保護し、他の当月選択は前月に揃える', () => {
  const s = screen(); show(s, [blue, quiet]); s.change(`${quiet}の1行目の業務内容`, '当月の入力'); s.manage(); s.copy();
  assert.equal(s.visible(quiet).checked, true); assert.equal(s.visible(quiet).disabled, true); s.apply(); assert.equal(s.cards().length, 3);
  assert.equal(s.find(`${quiet}の1行目の業務内容`).value, '当月の入力');
});
test('S31-M06：明細0件で保存した表示ONも引き継ぎ、前月の設定を変更しない', () => {
  const s = screen(); show(s, [quiet]); s.save(); s.next(); assert.equal(s.cards().length, 0); s.manage(); s.copy();
  assert.equal(s.visible(blue).checked, false); assert.equal(s.visible(quiet).checked, true); s.apply(); s.save(); s.prev(); assert.equal(s.cards().length, 1);
  assert.ok(s.find(`${quiet}の1行目の業務内容`)); assert.equal(s.find(`${blue}の1行目の業務内容`), undefined);
});
test('S31-M07：1月のコピーは前年12月を参照する', () => {
  const s = screen('2027-01-02T12:00:00+09:00'); s.manage(); s.copy(); assert.match(s.ids['mc-copy-result'].textContent, /2026年12月/); s.apply(); assert.equal(s.cards().length, 2);
});
test('S31-M07：前月にデータがなければ全社OFFをコピーし結果を案内する', () => {
  const s = screen(); s.next(); show(s, [quiet]); s.manage(); s.copy(); assert.equal(s.visible(quiet).checked, false); assert.match(s.ids['mc-copy-result'].textContent, /表示する会社はありません/); s.apply(); assert.equal(s.cards().length, 0);
});
test('S31-M08：保存・月往復で設定を復元し、未保存の中止・破棄・保存を扱う', () => {
  const s = screen(); show(s, [quiet]); s.save(); s.next(); assert.equal(s.cards().length, 0); s.prev(); assert.equal(s.cards().length, 1);
  s.manage(); s.toggle(quiet, false); s.apply(); s.next(); s.stay(); assert.equal(s.cards().length, 0);
  s.next(); s.discard(); s.prev(); assert.equal(s.cards().length, 1);
  s.manage(); s.toggle(quiet, false); s.apply(); s.next(); s.saveAndSwitch(); s.prev(); assert.equal(s.cards().length, 0);
});
test('S31-M02：Escでモーダル内の選択と追加を破棄する', () => {
  const s = screen(); s.manage(); s.toggle(blue, true); s.add('取消会社（架空）'); let prevented = false;
  s.ids['mc-dialog'].oncancel({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(s.cards().length, 0);
  s.manage(); assert.equal(s.visible(blue).checked, false); assert.equal(s.visible('取消会社（架空）'), undefined);
});
test('S31-M05/M08：反映後の未保存会社は月切替の破棄で除き、保存した会社は他月で非表示から始まる', () => {
  const s = screen(); s.manage(); s.add('未保存会社（架空）'); s.apply(); s.next(); s.discard(); s.manage();
  assert.equal(s.visible('未保存会社（架空）'), undefined); s.cancel(); s.prev(); s.manage(); assert.equal(s.visible('未保存会社（架空）'), undefined);
  s.add('保存会社（架空）'); s.apply(); s.save(); s.next(); s.manage(); assert.equal(s.visible('保存会社（架空）').checked, false); s.cancel(); s.prev();
  assert.ok(s.find('保存会社（架空）の1行目の業務内容'));
});
