const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
function screen(today){
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.value='';this.textContent='';}
  append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(k,v){this.attrs[k]=v;}showModal(){}close(){}focus(){}reportValidity(){return !!this.value;}
 }
 const ids=Object.fromEntries(['mc-list','mc-summary','mc-dialog','mc-name','mc-period','mc-add-company','mc-cancel','mc-confirm','mc-prev','mc-next','mc-save','mc-save-status','mc-switch-dialog','mc-switch-save','mc-switch-discard','mc-switch-cancel','mc-switch-error'].map(id=>[id,new Element()]));
 const root={querySelector:selector=>ids[selector.slice(1)]};
 const Clock=today?class extends Date{constructor(...args){super(...(args.length?args:[today]));}}:Date;
 const source=fs.readFileSync(__dirname+'/multiple-companies.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(source,{document:{getElementById:()=>root,createElement:tag=>new Element(tag)},Date:Clock});
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 const find=label=>[...descendants(ids['mc-list']),...descendants(ids['mc-summary'])].find(n=>n.attrs['aria-label']===label);
 const total=index=>descendants(ids['mc-list'].children[index]).find(n=>n.tagName==='strong').textContent;
 const addCompany=()=>{ids['mc-add-company'].onclick();ids['mc-name'].value='追加会社（架空）';ids['mc-confirm'].onclick();};
 const addRow=index=>descendants(ids['mc-list'].children[index]).find(n=>n.tagName==='button'&&n.textContent==='＋ 報酬明細を追加').onclick();
 const card=index=>ids['mc-list'].children[index];
 const hasAdd=index=>descendants(card(index)).some(n=>n.tagName==='button'&&n.textContent==='＋ 報酬明細を追加');
 const status=index=>descendants(card(index)).find(n=>n.className==='status-label')?.textContent;
 const taxTotal=index=>descendants(card(index)).find(n=>n.className==='tax-summary')?.textContent;
 const discountTotal=index=>descendants(card(index)).find(n=>n.className==='discount-summary')?.textContent;
 const summary=name=>{const row=find(`${name}の月次集計`);assert.ok(row,'会社別の集計行');const cells=row.children.map(n=>n.textContent);return [cells[0],...cells.slice(2)];};
 const summaryStatus=name=>find(`${name}の月次集計`).children[1].textContent;
 return {find,total,taxTotal,discountTotal,addCompany,addRow,card,hasAdd,status,summary,summaryStatus,
  next:()=>ids['mc-next'].onclick(),prev:()=>ids['mc-prev'].onclick(),save:()=>ids['mc-save'].onclick(),
  cancel:()=>ids['mc-switch-cancel'].onclick(),discard:()=>ids['mc-switch-discard'].onclick(),saveAndSwitch:()=>ids['mc-switch-save'].onclick(),
  switchError:()=>ids['mc-switch-error'].textContent,saveStatus:()=>ids['mc-save-status'].textContent,period:()=>ids['mc-period'].textContent};
}
test('各社で明細を追加でき、請求済にすれば編集を止める',()=>{
 const s=screen();assert.equal(s.find('こもれび企画（架空）の1行目の報酬額（円）').disabled,false);
 s.addRow(1);assert.ok(s.find('こもれび企画（架空）の2行目の報酬額（円）'));
 const check=s.find('こもれび企画（架空）の請求済');check.checked=true;check.onchange();
 assert.equal(s.find('こもれび企画（架空）の1行目の報酬額（円）').disabled,true);
});
test('未請求→請求済→入金済でカードとラベルを切替、請求済以降は追加ボタンを非表示',()=>{
 const s=screen();assert.equal(s.status(0),'未請求');assert.equal(s.hasAdd(0),true);
 let check=s.find('青葉編集室（架空）の請求済');check.checked=true;check.onchange();
 assert.equal(s.status(0),'請求済み');assert.ok(s.card(0).className.includes('is-invoiced'));assert.equal(s.hasAdd(0),false);
 check=s.find('青葉編集室（架空）の入金済');check.checked=true;check.onchange();
 assert.equal(s.status(0),'入金済み');assert.ok(s.card(0).className.includes('is-paid'));assert.equal(s.card(0).className.includes('is-invoiced'),false);assert.equal(s.hasAdd(0),false);
 check=s.find('青葉編集室（架空）の入金済');check.checked=false;check.onchange();assert.equal(s.status(0),'請求済み');
 check=s.find('青葉編集室（架空）の請求済');check.checked=false;check.onchange();assert.equal(s.hasAdd(0),true);assert.equal(s.status(0),'未請求');
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');assert.equal(s.status(1),'未請求');
});
test('会社追加直後に空の明細が1行あり、そのまま入力できる',()=>{
 const s=screen();s.addCompany();
 const text=s.find('追加会社（架空）の1行目の業務内容'),amount=s.find('追加会社（架空）の1行目の報酬額（円）');
 assert.ok(text);assert.ok(amount);assert.equal(text.value,'');assert.equal(amount.value,'');
 assert.equal(s.find('追加会社（架空）の2行目の業務内容'),undefined);
 assert.equal(s.total(2),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
 text.value='編集';text.oninput();amount.value='12000';amount.oninput();assert.equal(s.total(2),'小計 ¥13,200 / 報酬額 ¥12,000 / 交通費 ¥0');
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
 s.addRow(2);assert.ok(s.find('追加会社（架空）の2行目の業務内容'));
});
test('追加会社の数字入力を合計へ反映し、カンマは表示時だけ付ける',()=>{
 const s=screen();s.addCompany();const input=s.find('追加会社（架空）の1行目の報酬額（円）');
 input.onfocus();input.value='12500';input.oninput();assert.equal(s.total(2),'小計 ¥13,750 / 報酬額 ¥12,500 / 交通費 ¥0');
 input.onblur();assert.equal(input.value,'12,500');input.onfocus();assert.equal(input.value,'12500');
 input.value='25000';input.oninput();assert.equal(s.total(2),'小計 ¥27,500 / 報酬額 ¥25,000 / 交通費 ¥0');
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
});
test('報酬欄は半角数字と空欄だけ受け付け、不正入力は直前の値と合計を保持する',()=>{
 const s=screen();s.addCompany();const input=s.find('追加会社（架空）の1行目の報酬額（円）');
 assert.equal(input.value,'');input.onfocus();input.value='12000';input.oninput();
 for(const invalid of ['abc','１２３','あいう','-12000','+12000','12.5','1e3','12,000','12 000','12000円']){
  input.value=invalid;input.oninput();assert.equal(input.value,'12000',invalid);assert.equal(s.total(2),'小計 ¥13,200 / 報酬額 ¥12,000 / 交通費 ¥0');
 }
 input.value='';input.oninput();assert.equal(input.value,'');assert.equal(s.total(2),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
});
test('日本語変換の確定でも文字を金額へ反映しない',()=>{
 const s=screen(),input=s.find('青葉編集室（架空）の1行目の報酬額（円）');input.onfocus();
 input.oncompositionstart();input.value='あ';input.oninput({isComposing:true});assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');
 input.oncompositionend();assert.equal(input.value,'50000');assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');
 input.onblur();assert.equal(input.value,'50,000');
});

test('S08-M01：同一会社の時給の単価と案件単価の報酬額を分けて保持する',()=>{
 const s=screen(),a='青葉編集室（架空）';s.addRow(0);
 const type=s.find(`${a}の1行目の報酬タイプ`);assert.ok(type);
 assert.deepEqual(type.children.map(o=>o.textContent),['時給','案件単価','交通費']);
 type.value='hourly';type.onchange();
 const rate=s.find(`${a}の1行目の単価（円）`);rate.value='3500.5';rate.oninput();
 const other=s.find(`${a}の2行目の報酬額（円）`);other.value='15000';other.oninput();s.addRow(1);
 assert.equal(s.find(`${a}の1行目の報酬タイプ`).value,'hourly');
 assert.equal(s.find(`${a}の2行目の報酬タイプ`).value,'per_item');
 assert.equal(s.find(`${a}の1行目の単価（円）`).value,'3500.5');
 assert.equal(s.find(`${a}の2行目の単価（円）`),undefined);assert.equal(s.find(`${a}の2行目の報酬額（円）`).value,'15,000');
 assert.equal(s.find('こもれび企画（架空）の1行目の単価（円）').value,'3000');
});

test('S08-M02：時給は自動計算し、案件単価へ戻すと手入力額を復元し、請求済みで編集停止する',()=>{
 const s=screen(),a='青葉編集室（架空）';
 assert.equal(s.find(`${a}の1行目の時間`),undefined);
 let type=s.find(`${a}の1行目の報酬タイプ`);assert.ok(type);type.value='hourly';type.onchange();
 const rate=s.find(`${a}の1行目の単価（円）`);rate.value='3000';rate.oninput();
 let hours=s.find(`${a}の1行目の時間`);assert.ok(hours);hours.value='1.5';hours.oninput();
 const check=s.find(`${a}の請求済`);check.checked=true;check.onchange();
 for(const key of ['報酬タイプ','単価（円）','時間'])assert.equal(s.find(`${a}の1行目の${key}`).disabled,true);
 assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'4,500');
 assert.equal(s.find(`${a}の1行目の業務内容`).value,'採用インタビューの原稿作成');
 assert.equal(s.total(0),'小計 ¥4,500 / 報酬額 ¥4,500 / 交通費 ¥0');
 const back=s.find(`${a}の請求済`);back.checked=false;back.onchange();
 for(const key of ['報酬タイプ','単価（円）','時間'])assert.equal(s.find(`${a}の1行目の${key}`).disabled,false);
 type=s.find(`${a}の1行目の報酬タイプ`);type.value='per_item';type.onchange();
 assert.equal(s.find(`${a}の1行目の時間`),undefined);assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'50,000');
 type=s.find(`${a}の1行目の報酬タイプ`);type.value='hourly';type.onchange();
 assert.equal(s.find(`${a}の1行目の時間`).value,'1.5');
 assert.equal(s.total(0),'小計 ¥4,500 / 報酬額 ¥4,500 / 交通費 ¥0');assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
});

test('S08-M03：新しい明細と会社は案件単価から入力でき、他明細の値をコピーしない',()=>{
 const s=screen(),a='青葉編集室（架空）';s.addRow(0);s.addCompany();
 for(const prefix of [`${a}の2行目`,'追加会社（架空）の1行目']){
  const type=s.find(`${prefix}の報酬タイプ`);assert.ok(type);assert.equal(type.value,'per_item');
  assert.equal(s.find(`${prefix}の単価（円）`),undefined);assert.equal(s.find(`${prefix}の報酬額（円）`).value,'');
  assert.equal(s.find(`${prefix}の時間`),undefined);
 }
 assert.equal(s.find(`${a}の1行目の単価（円）`),undefined);
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');assert.equal(s.total(2),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
});

test('S09-M01：小数時間と単価を保持して自社の報酬を自動計算し、他社へ影響しない',()=>{
 const s=screen(),a='こもれび企画（架空）';
 const hours=s.find(`${a}の1行目の時間`),rate=s.find(`${a}の1行目の単価（円）`);assert.ok(hours);assert.ok(rate);
 hours.value='1.5';hours.oninput();rate.value='2500';rate.oninput();s.addRow(1);
 assert.equal(s.find(`${a}の1行目の時間`).value,'1.5');assert.equal(s.find(`${a}の1行目の単価（円）`).value,'2500');
 assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'3,750');assert.equal(s.total(1),'小計 ¥3,750 / 報酬額 ¥3,750 / 交通費 ¥0');
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');
});

test('単価と小数時間は不正な文字を数値へ読み替えず、空欄・0・小数を保持する',()=>{
 const s=screen(),a='こもれび企画（架空）';
 for(const key of ['時間','単価（円）']){
  const input=s.find(`${a}の1行目の${key}`);input.value='1.5';input.oninput();
  for(const value of ['abc','１.５','-1.5','1e3','1,000','1.2.3']){input.value=value;input.oninput();assert.equal(input.value,'1.5',value);}
  for(const value of ['','0','0.25']){input.value=value;input.oninput();assert.equal(input.value,value);}
 }
 s.addRow(1);assert.equal(s.find(`${a}の1行目の時間`).value,'0.25');assert.equal(s.find(`${a}の1行目の単価（円）`).value,'0.25');
 assert.equal(s.total(1),'小計 ¥1 / 報酬額 ¥1 / 交通費 ¥0');
});

test('S08-M05：適用開始日・終了日を表示せず、会社追加後も明細の条件を入力できる',()=>{
 const s=screen();
 const inspect=node=>{assert.equal(/単価の適用期間|適用開始日|適用終了日/.test(node.textContent||''),false);assert.notEqual(node.type,'date');node.children.forEach(inspect);};
 inspect(s.card(0));inspect(s.card(1));s.addCompany();inspect(s.card(2));
 const amount=s.find('追加会社（架空）の1行目の報酬額（円）');amount.value='12500';amount.oninput();s.addRow(2);
 assert.equal(s.find('追加会社（架空）の1行目の報酬額（円）').value,'12,500');
 assert.ok(s.find('こもれび企画（架空）の1行目の時間'));
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
});

test('S09-M02：時給は報酬額の手入力不可で、時間・単価の変更を金額と合計へ即時反映',()=>{
 const s=screen(),a='こもれび企画（架空）';
 const amount=s.find(`${a}の1行目の報酬額（円）`),hours=s.find(`${a}の1行目の時間`),rate=s.find(`${a}の1行目の単価（円）`);
 assert.equal(amount.readOnly,true);hours.value='1.5';hours.oninput();assert.equal(amount.value,'4,500');assert.equal(s.total(1),'小計 ¥4,500 / 報酬額 ¥4,500 / 交通費 ¥0');
 amount.value='99999';amount.oninput();assert.equal(amount.value,'4,500');assert.equal(s.total(1),'小計 ¥4,500 / 報酬額 ¥4,500 / 交通費 ¥0');
 rate.value='2500';rate.oninput();assert.equal(amount.value,'3,750');s.addRow(1);
 assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'3,750');assert.equal(s.total(1),'小計 ¥3,750 / 報酬額 ¥3,750 / 交通費 ¥0');
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');assert.notEqual(s.find('青葉編集室（架空）の1行目の報酬額（円）').readOnly,true);
});

test('S09-M03：時間・単価が空欄なら報酬も空欄、0は0円、不正入力は直前の計算結果を保持',()=>{
 const s=screen(),a='こもれび企画（架空）';
 const hours=s.find(`${a}の1行目の時間`),rate=s.find(`${a}の1行目の単価（円）`),amount=s.find(`${a}の1行目の報酬額（円）`);
 hours.value='';hours.oninput();assert.equal(amount.value,'');assert.equal(s.total(1),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
 hours.value='0';hours.oninput();assert.equal(amount.value,'0');
 hours.value='1.5';hours.oninput();assert.equal(amount.value,'4,500');
 hours.value='あ';hours.oninput();assert.equal(hours.value,'1.5');assert.equal(amount.value,'4,500');
 rate.value='';rate.oninput();assert.equal(amount.value,'');rate.value='0';rate.oninput();assert.equal(amount.value,'0');
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');
});

test('S09-M04：明細ごとに1円未満を切り上げ、十進小数の計算誤差で余計な1円を加えない',()=>{
 const s=screen(),a='こもれび企画（架空）';
 const hours=s.find(`${a}の1行目の時間`),rate=s.find(`${a}の1行目の単価（円）`),amount=s.find(`${a}の1行目の報酬額（円）`);
 for(const [h,r,expected] of [['1.5','3001','4,502'],['1.1','100','110'],['0.1','0.1','1'],['0','3000','0'],['0.0001','0.0001','1']]){
  hours.value=h;hours.oninput();rate.value=r;rate.oninput();assert.equal(amount.value,expected,`${h}×${r}`);
 }
 hours.value='1000000000';hours.oninput();rate.value='1';rate.oninput();assert.match(s.total(1),/入力を確認/);
 rate.value='0';rate.oninput();assert.equal(amount.value,'0');assert.equal(s.total(1),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
});

test('時給の各明細で切り上げた金額と、案件単価の手入力報酬を同じ会社の合計へ集約する',()=>{
 const s=screen(),a='こもれび企画（架空）';
 const set=(i,key,value)=>{const input=s.find(`${a}の${i}行目の${key}`);input.value=value;input.oninput();};
 set(1,'時間','0.1');set(1,'単価（円）','1');s.addRow(1);
 let type=s.find(`${a}の2行目の報酬タイプ`);type.value='hourly';type.onchange();
 set(2,'時間','0.1');set(2,'単価（円）','1');assert.equal(s.total(1),'小計 ¥2 / 報酬額 ¥2 / 交通費 ¥0');
 s.addRow(1);set(3,'報酬額（円）','500');assert.equal(s.total(1),'小計 ¥552 / 報酬額 ¥502 / 交通費 ¥0');
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');
});

test('S08-M07：案件単価の時間・単価は—で、報酬額だけを入力して合計を更新できる',()=>{
 const s=screen(),a='青葉編集室（架空）';
 assert.equal(s.find(`${a}の1行目の時間`),undefined);assert.equal(s.find(`${a}の1行目の単価（円）`),undefined);
 assert.equal(s.find(`${a}の1行目の単価は使用しません`).textContent,'—');
 const amount=s.find(`${a}の1行目の報酬額（円）`);assert.notEqual(amount.readOnly,true);amount.onfocus();amount.value='12500';amount.oninput();amount.onblur();
 assert.equal(amount.value,'12,500');assert.equal(s.total(0),'小計 ¥12,500 / 報酬額 ¥12,500 / 交通費 ¥0');assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
 s.addRow(0);assert.equal(s.find(`${a}の2行目の単価（円）`),undefined);assert.equal(s.find(`${a}の2行目の単価は使用しません`).textContent,'—');
 let blankType=s.find(`${a}の2行目の報酬タイプ`);blankType.value='hourly';blankType.onchange();
 for(const [key,value] of [['時間','2'],['単価（円）','1500']]){const input=s.find(`${a}の2行目の${key}`);input.value=value;input.oninput();}
 blankType=s.find(`${a}の2行目の報酬タイプ`);blankType.value='per_item';blankType.onchange();assert.equal(s.find(`${a}の2行目の報酬額（円）`).value,'');
 let type=s.find(`${a}の1行目の報酬タイプ`);type.value='hourly';type.onchange();
 const rate=s.find(`${a}の1行目の単価（円）`),hours=s.find(`${a}の1行目の時間`);assert.equal(rate.value,'');rate.value='3000';rate.oninput();hours.value='1.5';hours.oninput();
 assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'4,500');
 type=s.find(`${a}の1行目の報酬タイプ`);type.value='per_item';type.onchange();assert.equal(s.find(`${a}の1行目の単価（円）`),undefined);assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'12,500');
 type=s.find(`${a}の1行目の報酬タイプ`);type.value='hourly';type.onchange();assert.equal(s.find(`${a}の1行目の単価（円）`).value,'3000');assert.equal(s.find(`${a}の1行目の時間`).value,'1.5');
});


test('S10-M01：交通費は金額を直接入力し、報酬と区別して合算する',()=>{
 const s=screen(),a='青葉編集室（架空）';s.addRow(0);
 let type=s.find(`${a}の2行目の報酬タイプ`);assert.ok(type.children.some(o=>o.textContent==='交通費'));type.value='travel';type.onchange();
 assert.equal(s.find(`${a}の2行目の時間`),undefined);assert.equal(s.find(`${a}の2行目の単価（円）`),undefined);
 assert.equal(s.find(`${a}の2行目の単価は使用しません`).textContent,'—');
 const text=s.find(`${a}の2行目の業務内容`);text.value='取材の往復交通費';text.oninput();
 const amount=s.find(`${a}の2行目の交通費（円）`);assert.equal(amount.readOnly,false);amount.onfocus();amount.value='1250';amount.oninput();amount.onblur();
 assert.equal(amount.value,'1,250');assert.equal(s.total(0),'小計 ¥51,250 / 報酬額 ¥50,000 / 交通費 ¥1,250');assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
});
test('S10-M02：交通費の切替と再表示で内容・金額・時間・単価を保持する',()=>{
 const s=screen(),a='青葉編集室（架空）';
 const change=value=>{const type=s.find(`${a}の1行目の報酬タイプ`);type.value=value;type.onchange();};
 change('travel');assert.equal(s.find(`${a}の1行目の交通費（円）`).value,'50,000');
 let amount=s.find(`${a}の1行目の交通費（円）`);amount.onfocus();amount.value='1200';amount.oninput();
 change('hourly');for(const [key,value] of [['時間','1.5'],['単価（円）','3001']]){const input=s.find(`${a}の1行目の${key}`);input.value=value;input.oninput();}
 assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'4,502');
 change('travel');assert.equal(s.find(`${a}の1行目の交通費（円）`).value,'1,200');s.addRow(0);
 assert.equal(s.find(`${a}の1行目の交通費（円）`).value,'1,200');assert.equal(s.find(`${a}の1行目の業務内容`).value,'採用インタビューの原稿作成');
 assert.equal(s.find(`${a}の2行目の報酬タイプ`).value,'per_item');assert.equal(s.find(`${a}の2行目の報酬額（円）`).value,'');
 change('per_item');assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'1,200');
 change('hourly');assert.equal(s.find(`${a}の1行目の時間`).value,'1.5');assert.equal(s.find(`${a}の1行目の単価（円）`).value,'3001');
});
test('S10-M03：交通費の空欄・0・不正入力・請求済みの編集停止',()=>{
 const s=screen(),a='青葉編集室（架空）';let type=s.find(`${a}の1行目の報酬タイプ`);type.value='travel';type.onchange();
 let amount=s.find(`${a}の1行目の交通費（円）`);amount.onfocus();amount.value='1200';amount.oninput();
 for(const invalid of ['-1','1.2','１２００','1e3','1000000000']){amount.value=invalid;amount.oninput();assert.equal(amount.value,'1200');}
 amount.value='';amount.oninput();assert.equal(amount.value,'');amount.value='0';amount.oninput();assert.equal(amount.value,'0');
 assert.equal(s.total(0),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
 const check=s.find(`${a}の請求済`);check.checked=true;check.onchange();
 for(const key of ['業務内容','報酬タイプ','交通費（円）'])assert.equal(s.find(`${a}の1行目の${key}`).disabled,true);
 amount=s.find(`${a}の1行目の交通費（円）`);amount.value='999';amount.oninput();assert.equal(amount.value,'0');
 const back=s.find(`${a}の請求済`);back.checked=false;back.onchange();assert.equal(s.find(`${a}の1行目の交通費（円）`).disabled,false);
});


const taxChange=(s,a,i,value)=>{const input=s.find(`${a}の${i}行目の税込／税抜`);assert.ok(input,'明細の税区分選択');input.value=value;input.onchange();};
const amountChange=(s,a,i,value,key='報酬額（円）')=>{const input=s.find(`${a}の${i}行目の${key}`);input.value=value;input.oninput();};
test('S11-M01：既存は税込、新規報酬は税抜、交通費は税込を初期値にする',()=>{
 const s=screen(),a='青葉編集室（架空）';
 assert.equal(s.find(`${a}の1行目の税込／税抜`)?.value,'inclusive');
 assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');
 s.addRow(0);assert.equal(s.find(`${a}の2行目の税込／税抜`).value,'exclusive');
 const type=s.find(`${a}の2行目の報酬タイプ`);type.value='travel';type.onchange();
 assert.equal(s.find(`${a}の2行目の税込／税抜`).value,'inclusive');
 s.addCompany();assert.equal(s.find('追加会社（架空）の1行目の税込／税抜').value,'exclusive');
});
test('S11-M02：税込・税抜の混在を会社単位で計算する',()=>{
 const s=screen(),a='青葉編集室（架空）';
 amountChange(s,a,1,'1000');taxChange(s,a,1,'exclusive');s.addRow(0);
 amountChange(s,a,2,'1100');taxChange(s,a,2,'inclusive');
 assert.equal(s.total(0),'小計 ¥2,200 / 報酬額 ¥2,100 / 交通費 ¥0');
 assert.equal(s.taxTotal(0),'税抜合計 ¥2,000 / 消費税（10%） ¥200');
 assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
 taxChange(s,a,2,'exclusive');assert.equal(s.total(0),'小計 ¥2,310 / 報酬額 ¥2,100 / 交通費 ¥0');
 assert.equal(s.taxTotal(0),'税抜合計 ¥2,100 / 消費税（10%） ¥210');
});
test('S11-M03：税は明細で丸めず、会社の税込・税抜の合算額から切り捨てる',()=>{
 const s=screen(),a='青葉編集室（架空）';s.addRow(0);
 for(const i of [1,2]){amountChange(s,a,i,'5');taxChange(s,a,i,'exclusive');}
 assert.equal(s.total(0),'小計 ¥11 / 報酬額 ¥10 / 交通費 ¥0');
 assert.equal(s.taxTotal(0),'税抜合計 ¥10 / 消費税（10%） ¥1');
 for(const i of [1,2]){amountChange(s,a,i,'6');taxChange(s,a,i,'inclusive');}
 assert.equal(s.total(0),'小計 ¥12 / 報酬額 ¥12 / 交通費 ¥0');
 assert.equal(s.taxTotal(0),'税抜合計 ¥11 / 消費税（10%） ¥1');
 // 290円の税額が浮動小数点の誤差で28円にならない。
 amountChange(s,a,1,'290');amountChange(s,a,2,'0');taxChange(s,a,1,'exclusive');
 assert.equal(s.taxTotal(0),'税抜合計 ¥290 / 消費税（10%） ¥29');
});
test('S11-M04：区分の往復保持と請求済ロック、解除後の変更',()=>{
 const s=screen(),a='青葉編集室（架空）';
 const change=value=>{const type=s.find(`${a}の1行目の報酬タイプ`);type.value=value;type.onchange();};
 taxChange(s,a,1,'exclusive');change('travel');assert.equal(s.find(`${a}の1行目の税込／税抜`).value,'inclusive');
 taxChange(s,a,1,'exclusive');change('hourly');assert.equal(s.find(`${a}の1行目の税込／税抜`).value,'exclusive');
 change('per_item');assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'50,000');
 change('travel');assert.equal(s.find(`${a}の1行目の税込／税抜`).value,'exclusive');
 let check=s.find(`${a}の請求済`);check.checked=true;check.onchange();
 assert.equal(s.find(`${a}の1行目の税込／税抜`).disabled,true);
 taxChange(s,a,1,'inclusive');assert.equal(s.find(`${a}の1行目の税込／税抜`).value,'exclusive');
 check=s.find(`${a}の請求済`);check.checked=false;check.onchange();
 taxChange(s,a,1,'inclusive');assert.equal(s.find(`${a}の1行目の税込／税抜`).disabled,false);
 assert.equal(s.find(`${a}の1行目の交通費（円）`).value,'50,000');
});
test('S11-M05：時給の切り上げ後に税を切り捨て、空欄・0・上限超過を扱う',()=>{
 const s=screen(),a='こもれび企画（架空）';taxChange(s,a,1,'exclusive');
 for(const [key,value] of [['時間','1.5'],['単価（円）','3001']]){const input=s.find(`${a}の1行目の${key}`);input.value=value;input.oninput();}
 assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'4,502');
 assert.equal(s.total(1),'小計 ¥4,952 / 報酬額 ¥4,502 / 交通費 ¥0');
 assert.equal(s.taxTotal(1),'税抜合計 ¥4,502 / 消費税（10%） ¥450');
 const hours=s.find(`${a}の1行目の時間`);hours.value='';hours.oninput();assert.equal(s.taxTotal(1),'税抜合計 ¥0 / 消費税（10%） ¥0');
 hours.value='0';hours.oninput();assert.equal(s.taxTotal(1),'税抜合計 ¥0 / 消費税（10%） ¥0');
 hours.value='1000000000';hours.oninput();assert.match(s.total(1),/入力を確認/);assert.match(s.taxTotal(1),/入力を確認/);
});


const discountChange=(s,a,i,value)=>{const input=s.find(`${a}の${i}行目の値引き`);assert.ok(input,'明細の値引き選択');input.value=value;input.onchange();};
const discountRateChange=(s,a,i,value)=>{const input=s.find(`${a}の${i}行目の値引き率（%）`);assert.ok(input,'明細の値引き率');input.value=value;input.oninput();return input;};
test('S12-M01：値引きは初期値なし、対象月の境界で率が変わり、新規会社・明細も同じ初期値',()=>{
 for(const [date,expected] of [['2026-09-30T12:00:00+09:00','1.3'],['2026-10-01T12:00:00+09:00','2'],['2027-01-01T12:00:00+09:00','2']]){
  const s=screen(date),a='青葉編集室（架空）';s.addRow(0);s.addCompany();
  for(const prefix of [`${a}の1行目`,`${a}の2行目`,'追加会社（架空）の1行目']){
   assert.equal(s.find(`${prefix}の値引き`)?.value,'none');
   assert.equal(s.find(`${prefix}の値引き率（%）`)?.value,'-');
   assert.equal(s.find(`${prefix}の値引き率（%）`)?.disabled,true);
   let choice=s.find(`${prefix}の値引き`);choice.value='apply';choice.onchange();
   assert.equal(s.find(`${prefix}の値引き率（%）`)?.value,expected);
   choice=s.find(`${prefix}の値引き`);choice.value='none';choice.onchange();
  }
  assert.equal(s.total(0),'小計 ¥50,000 / 報酬額 ¥50,000 / 交通費 ¥0');
 }
});
test('S12-M02：同率を合算して切り捨て、異なる率・値引きなし・他社を合算しない',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='青葉編集室（架空）';s.addRow(0);
 for(const i of [1,2]){amountChange(s,a,i,'75');taxChange(s,a,i,'exclusive');discountChange(s,a,i,'apply');}
 assert.equal(s.total(0),'小計 ¥162 / 報酬額 ¥150 / 交通費 ¥0');
 assert.match(s.discountTotal(0),/2%.*¥3/);
 discountRateChange(s,a,2,'2.0');assert.match(s.discountTotal(0),/2%.*¥3/);
 discountRateChange(s,a,2,'1.3');assert.equal(s.total(0),'小計 ¥163 / 報酬額 ¥150 / 交通費 ¥0');
 assert.match(s.discountTotal(0),/2%.*¥1/);assert.match(s.discountTotal(0),/1.3%.*¥1/);
 discountChange(s,a,2,'none');assert.equal(s.total(0),'小計 ¥164 / 報酬額 ¥150 / 交通費 ¥0');
 assert.equal(s.find(`${a}の1行目の値引き率（%）`).value,'2');
 assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
});
test('S12-M03：税込へ揃えた報酬だけを値引きし、交通費と入力額を保持する',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='青葉編集室（架空）';
 amountChange(s,a,1,'10000');taxChange(s,a,1,'exclusive');discountChange(s,a,1,'apply');s.addRow(0);
 const type=s.find(`${a}の2行目の報酬タイプ`);type.value='travel';type.onchange();
 amountChange(s,a,2,'1000','交通費（円）');taxChange(s,a,2,'exclusive');
 assert.equal(s.find(`${a}の2行目の値引き`),undefined);assert.equal(s.find(`${a}の2行目の値引き率（%）`),undefined);
 assert.equal(s.total(0),'小計 ¥11,880 / 報酬額 ¥10,000 / 交通費 ¥1,000');
 assert.equal(s.taxTotal(0),'値引前税抜合計 ¥11,000 / 値引前消費税（10%） ¥1,100');
 assert.match(s.discountTotal(0),/2%.*¥220/);
 assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'10,000');
});
test('S12-M04/S13-M08：値引きなしは率を-表示し、値引き条件を再表示・種類の往復で保持し、請求済で変更を拒否する',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='青葉編集室（架空）';
 amountChange(s,a,1,'10000');taxChange(s,a,1,'exclusive');discountChange(s,a,1,'apply');discountRateChange(s,a,1,'1.3');s.addRow(0);
 assert.equal(s.find(`${a}の1行目の値引き率（%）`).value,'1.3');
 let type=s.find(`${a}の1行目の報酬タイプ`);type.value='travel';type.onchange();assert.equal(s.find(`${a}の1行目の値引き`),undefined);
 assert.equal(s.total(0),'小計 ¥10,000 / 報酬額 ¥0 / 交通費 ¥10,000');
 type=s.find(`${a}の1行目の報酬タイプ`);type.value='per_item';type.onchange();
 assert.equal(s.find(`${a}の1行目の値引き`).value,'apply');assert.equal(s.find(`${a}の1行目の値引き率（%）`).value,'1.3');
 assert.equal(s.total(0),'小計 ¥10,857 / 報酬額 ¥10,000 / 交通費 ¥0');
 let check=s.find(`${a}の請求済`);check.checked=true;check.onchange();
 for(const key of ['値引き','値引き率（%）'])assert.equal(s.find(`${a}の1行目の${key}`).disabled,true);
 discountRateChange(s,a,1,'2');discountChange(s,a,1,'none');
 assert.equal(s.find(`${a}の1行目の値引き`).value,'apply');assert.equal(s.find(`${a}の1行目の値引き率（%）`).value,'1.3');
 check=s.find(`${a}の請求済`);check.checked=false;check.onchange();discountChange(s,a,1,'none');
 assert.equal(s.total(0),'小計 ¥11,000 / 報酬額 ¥10,000 / 交通費 ¥0');
 assert.equal(s.find(`${a}の1行目の値引き率（%）`).value,'-');
 s.addRow(0);assert.equal(s.find(`${a}の1行目の値引き率（%）`).value,'-');
 discountChange(s,a,1,'apply');assert.equal(s.find(`${a}の1行目の値引き率（%）`).value,'1.3');
 assert.equal(s.total(0),'小計 ¥10,857 / 報酬額 ¥10,000 / 交通費 ¥0');
});
test('S12-M05：率を十進数で計算し、空欄・0・100％と不正入力を検証する',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='青葉編集室（架空）';amountChange(s,a,1,'290');taxChange(s,a,1,'exclusive');discountChange(s,a,1,'apply');
 discountRateChange(s,a,1,'10');assert.match(s.discountTotal(0),/10%.*¥31/);
 for(const invalid of ['-1','100.1','１.３','1e2','1,3','abc']){const input=discountRateChange(s,a,1,invalid);assert.equal(input.value,'10',invalid);}
 discountRateChange(s,a,1,'0');assert.equal(s.total(0),'小計 ¥319 / 報酬額 ¥290 / 交通費 ¥0');
 discountRateChange(s,a,1,'100');assert.equal(s.total(0),'小計 ¥0 / 報酬額 ¥290 / 交通費 ¥0');
 discountRateChange(s,a,1,'');assert.match(s.total(0),/入力を確認/);discountChange(s,a,1,'none');assert.equal(s.total(0),'小計 ¥319 / 報酬額 ¥290 / 交通費 ¥0');
});
test('S12-M05：時給の明細切り上げ後の報酬に値引きを適用する',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='こもれび企画（架空）';taxChange(s,a,1,'exclusive');
 for(const [key,value] of [['時間','1.5'],['単価（円）','3001']]){const input=s.find(`${a}の1行目の${key}`);input.value=value;input.oninput();}
 discountChange(s,a,1,'apply');assert.equal(s.find(`${a}の1行目の報酬額（円）`).value,'4,502');
 assert.match(s.discountTotal(1),/2%.*¥99/);assert.equal(s.total(1),'小計 ¥4,853 / 報酬額 ¥4,502 / 交通費 ¥0');
});
test('S12-M06：税込報酬と税抜報酬を税込へ揃えて値引きし、入力区分を保持する',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='青葉編集室（架空）';amountChange(s,a,1,'109');discountChange(s,a,1,'apply');
 assert.equal(s.total(0),'小計 ¥107 / 報酬額 ¥109 / 交通費 ¥0');assert.match(s.discountTotal(0),/2%.*¥2/);
 assert.equal(s.taxTotal(0),'値引前税抜合計 ¥100 / 値引前消費税（10%） ¥9');
 discountChange(s,a,1,'none');assert.equal(s.total(0),'小計 ¥109 / 報酬額 ¥109 / 交通費 ¥0');
 amountChange(s,a,1,'1000');taxChange(s,a,1,'exclusive');discountChange(s,a,1,'apply');s.addRow(0);amountChange(s,a,2,'1100');taxChange(s,a,2,'inclusive');discountChange(s,a,2,'apply');
 assert.equal(s.total(0),'小計 ¥2,156 / 報酬額 ¥2,100 / 交通費 ¥0');assert.match(s.discountTotal(0),/2%.*¥44/);
 assert.equal(s.taxTotal(0),'値引前税抜合計 ¥2,000 / 値引前消費税（10%） ¥200');
 assert.equal(s.find(`${a}の1行目の税込／税抜`).value,'exclusive');assert.equal(s.find(`${a}の2行目の税込／税抜`).value,'inclusive');
 taxChange(s,a,2,'exclusive');assert.equal(s.total(0),'小計 ¥2,264 / 報酬額 ¥2,100 / 交通費 ¥0');assert.match(s.discountTotal(0),/2%.*¥46/);
 discountChange(s,a,2,'none');assert.equal(s.total(0),'小計 ¥2,288 / 報酬額 ¥2,100 / 交通費 ¥0');
 assert.equal(s.total(1),'小計 ¥24,000 / 報酬額 ¥24,000 / 交通費 ¥0');
});

test('S12-M02/M03：他社の同率報酬や税込交通費を値引き対象へ混ぜない',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='青葉編集室（架空）',b='こもれび企画（架空）';
 amountChange(s,a,1,'75');taxChange(s,a,1,'exclusive');discountChange(s,a,1,'apply');
 const type=s.find(`${b}の1行目の報酬タイプ`);type.value='per_item';type.onchange();amountChange(s,b,1,'75');taxChange(s,b,1,'exclusive');discountChange(s,b,1,'apply');
 for(const i of [0,1]){assert.match(s.discountTotal(i),/2%.*¥1/);assert.match(s.total(i),/小計 ¥81 /);}
 amountChange(s,a,1,'10000');s.addRow(0);const travel=s.find(`${a}の2行目の報酬タイプ`);travel.value='travel';travel.onchange();amountChange(s,a,2,'1100','交通費（円）');
 assert.equal(s.total(0),'小計 ¥11,880 / 報酬額 ¥10,000 / 交通費 ¥1,100');assert.match(s.discountTotal(0),/2%.*¥220/);
 assert.equal(s.taxTotal(0),'値引前税抜合計 ¥11,000 / 値引前消費税（10%） ¥1,100');
});
test('S12-M05：値引き率の日本語変換・未適用欄・上限超過報酬で誤った合計を確定しない',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='こもれび企画（架空）';taxChange(s,a,1,'exclusive');discountChange(s,a,1,'apply');
 let input=s.find(`${a}の1行目の値引き率（%）`);input.oncompositionstart();input.value='２';input.oninput({isComposing:true});
 assert.match(s.discountTotal(1),/2%.*¥528/);input.oncompositionend();assert.equal(input.value,'2');
 discountChange(s,a,1,'none');input=discountRateChange(s,a,1,'100');assert.equal(input.value,'-');discountChange(s,a,1,'apply');assert.equal(s.find(`${a}の1行目の値引き率（%）`).value,'2');
 const hours=s.find(`${a}の1行目の時間`);hours.value='1000000000';hours.oninput();assert.match(s.total(1),/入力を確認/);assert.match(s.discountTotal(1),/入力を確認/);
 hours.value='';hours.oninput();assert.equal(s.total(1),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
});


test('S12-M02/M06：税込換算中は明細や率ごとに税額を丸めず、会社の税計算を維持する',()=>{
 const s=screen('2026-10-01T12:00:00+09:00'),a='青葉編集室（架空）';s.addRow(0);
 for(const i of [1,2]){amountChange(s,a,i,'5');taxChange(s,a,i,'exclusive');}
 discountChange(s,a,1,'apply');discountRateChange(s,a,1,'10');
 assert.equal(s.total(0),'小計 ¥11 / 報酬額 ¥10 / 交通費 ¥0');
 assert.equal(s.taxTotal(0),'値引前税抜合計 ¥10 / 値引前消費税（10%） ¥1');assert.match(s.discountTotal(0),/10%.*¥0/);
 discountChange(s,a,2,'apply');discountRateChange(s,a,2,'10');
 assert.equal(s.total(0),'小計 ¥10 / 報酬額 ¥10 / 交通費 ¥0');assert.match(s.discountTotal(0),/10%.*¥1/);
 discountRateChange(s,a,2,'0');assert.equal(s.total(0),'小計 ¥11 / 報酬額 ¥10 / 交通費 ¥0');
});

test('S13-M01：源泉は報酬明細のチェックと会社別の手入力だけを設け、初期値はなし・0円',()=>{
 const s=screen(),a='青葉編集室（架空）',b='こもれび企画（架空）';
 for(const name of [a,b]){
  const check=s.find(`${name}の1行目の源泉徴収あり`);assert.ok(check);assert.equal(check.type,'checkbox');assert.equal(check.checked,false);
  assert.equal(s.find(`${name}の源泉徴収額`).value,'0');
 }
 const head=s.card(0).children.find(n=>n.className==='company-head');
 const net=s.find(`${a}の請求額`),amount=s.find(`${a}の源泉徴収額`);
 assert.ok(head.children.includes(net),'請求額は会社見出しの上段に表示');
 const amountLabel=head.children.find(n=>n.children.includes(amount));assert.ok(amountLabel,'源泉徴収額は会社見出しの上段で手入力');
 assert.equal(amountLabel.textContent,'源泉徴収額');
 assert.ok(head.children.indexOf(net)<head.children.indexOf(amountLabel));
 assert.ok(head.children.indexOf(amountLabel)<head.children.findIndex(n=>n.tagName==='strong'));
 s.addRow(0);s.addCompany();
 for(const prefix of [`${a}の2行目`,'追加会社（架空）の1行目'])assert.equal(s.find(`${prefix}の源泉徴収あり`).checked,false);
 const type=s.find(`${a}の2行目の報酬タイプ`);type.value='travel';type.onchange();
 assert.equal(s.find(`${a}の2行目の源泉徴収あり`),undefined);
 assert.equal(s.find('追加会社（架空）の源泉徴収額').value,'0');
});
test('S13-M02/M03：MFの手入力額を引き、チェック・報酬・税・値引きの変更で源泉額を再計算しない',()=>{
 const s=screen(),a='青葉編集室（架空）',b='こもれび企画（架空）';
 const net=()=>s.find(`${a}の請求額`).textContent;
 const amount=s.find(`${a}の1行目の報酬額（円）`);amount.onfocus();amount.value='55000';amount.oninput();
 const withholding=s.find(`${a}の源泉徴収額`);assert.ok(withholding);withholding.onfocus();withholding.value='5105';withholding.oninput();
 assert.equal(net(),'請求額 ¥49,895');assert.match(s.total(0),/^小計 ¥55,000 /);
 const check=s.find(`${a}の1行目の源泉徴収あり`);check.checked=true;check.onchange();assert.equal(net(),'請求額 ¥49,895');
 assert.equal(s.find(`${b}の請求額`).textContent,'請求額 ¥24,000');
 const mode=s.find(`${a}の1行目の税込／税抜`);mode.value='exclusive';mode.onchange();assert.equal(net(),'請求額 ¥55,395');
 const discount=s.find(`${a}の1行目の値引き`);discount.value='apply';discount.onchange();
 assert.equal(s.find(`${a}の源泉徴収額`).value,'5,105');assert.equal(s.find(`${a}の1行目の源泉徴収あり`).checked,true);
 const off=s.find(`${a}の1行目の源泉徴収あり`);off.checked=false;off.onchange();
 assert.equal(s.find(`${a}の源泉徴収額`).value,'5,105');
 const type=s.find(`${a}の1行目の報酬タイプ`);type.value='travel';type.onchange();
 assert.equal(s.find(`${a}の源泉徴収額`).value,'5,105');assert.equal(s.find(`${a}の1行目の源泉徴収あり`),undefined);
 const back=s.find(`${a}の1行目の報酬タイプ`);back.value='per_item';back.onchange();assert.equal(s.find(`${a}の1行目の源泉徴収あり`).checked,false);
 const on=s.find(`${a}の1行目の源泉徴収あり`);on.checked=true;on.onchange();
 for(const kind of ['travel','hourly','per_item']){const input=s.find(`${a}の1行目の報酬タイプ`);input.value=kind;input.onchange();}
 assert.equal(s.find(`${a}の1行目の源泉徴収あり`).checked,true);assert.equal(s.find(`${a}の源泉徴収額`).value,'5,105');
});
test('S13-M03/M04：源泉額は円単位・0と空欄・表示切替・IMEを扱い、不正入力で値を変更しない',()=>{
 const s=screen(),a='青葉編集室（架空）';const input=s.find(`${a}の源泉徴収額`);assert.ok(input);
 input.onfocus();input.value='5105';input.oninput();input.onblur();assert.equal(input.value,'5,105');input.onfocus();assert.equal(input.value,'5105');
 for(const invalid of ['-1','+1','1.5','1e3','５１０５','5,105','1000000000','abc']){input.value=invalid;input.oninput();assert.equal(input.value,'5105',invalid);}
 input.oncompositionstart();input.value='あ';input.oninput({isComposing:true});assert.equal(s.find(`${a}の請求額`).textContent,'請求額 ¥44,895');
 input.oncompositionend();assert.equal(input.value,'5105');
 for(const empty of ['','0']){input.value=empty;input.oninput();assert.equal(s.find(`${a}の請求額`).textContent,'請求額 ¥50,000');}
 input.value='999999999';input.oninput();input.onblur();assert.equal(input.value,'999,999,999');
});
test('S13-M05：請求済では源泉チェックと手入力額を変更できず、入金済・解除でも額を保持',()=>{
 const s=screen(),a='青葉編集室（架空）';const amount=s.find(`${a}の源泉徴収額`);assert.ok(amount);amount.onfocus();amount.value='5105';amount.oninput();
 const initial=s.find(`${a}の1行目の源泉徴収あり`);initial.checked=true;initial.onchange();
 const invoice=s.find(`${a}の請求済`);invoice.checked=true;invoice.onchange();
 let check=s.find(`${a}の1行目の源泉徴収あり`),input=s.find(`${a}の源泉徴収額`);assert.equal(check.disabled,true);assert.equal(input.disabled,true);
 check.checked=false;check.onchange();input.value='1';input.oninput();assert.equal(check.checked,true);assert.equal(input.value,'5,105');
 const paid=s.find(`${a}の入金済`);paid.checked=true;paid.onchange();assert.equal(s.find(`${a}の請求額`).textContent,'請求額 ¥44,895');
 const unpaid=s.find(`${a}の入金済`);unpaid.checked=false;unpaid.onchange();const unlock=s.find(`${a}の請求済`);unlock.checked=false;unlock.onchange();
 assert.equal(s.find(`${a}の源泉徴収額`).disabled,false);assert.equal(s.find(`${a}の源泉徴収額`).value,'5,105');assert.equal(s.find(`${a}の1行目の源泉徴収あり`).checked,true);
});
test('S13-M06：小計が不正になれば古い差引予定額を残さず、手入力源泉額は保持',()=>{
 const s=screen(),a='青葉編集室（架空）';const input=s.find(`${a}の源泉徴収額`);assert.ok(input);input.onfocus();input.value='5105';input.oninput();
 const discount=s.find(`${a}の1行目の値引き`);discount.value='apply';discount.onchange();const rate=s.find(`${a}の1行目の値引き率（%）`);rate.value='';rate.oninput();
 assert.match(s.find(`${a}の請求額`).textContent,/入力を確認/);assert.equal(s.find(`${a}の源泉徴収額`).value,'5,105');
 const off=s.find(`${a}の1行目の値引き`);off.value='none';off.onchange();assert.equal(s.find(`${a}の請求額`).textContent,'請求額 ¥44,895');
 const type=s.find(`${a}の1行目の報酬タイプ`);type.value='hourly';type.onchange();const hours=s.find(`${a}の1行目の時間`),price=s.find(`${a}の1行目の単価（円）`);hours.value='1000000000';hours.oninput();price.value='1';price.oninput();
 assert.match(s.find(`${a}の請求額`).textContent,/入力を確認/);
});


test('S15-M01：月次入力の下部に会社別内訳と全社合計を表示する',()=>{
 const s=screen();
 assert.deepEqual(s.summary('青葉編集室（架空）'),['青葉編集室（架空）','¥50,000','¥0','¥50,000','¥50,000','¥0','¥45,455','¥4,545','¥0']);
 assert.deepEqual(s.summary('こもれび企画（架空）'),['こもれび企画（架空）','¥24,000','¥0','¥24,000','¥24,000','¥0','¥21,819','¥2,181','¥0']);
 assert.deepEqual(s.summary('全社合計'),['全社合計','¥74,000','¥0','¥74,000','¥74,000','¥0','¥67,274','¥6,726','¥0']);
});
test('S15-M02：税・交通費・値引き・源泉の変更を会社別と全社へ即時反映する',()=>{
 const s=screen('2026-11-02T12:00:00+09:00'),a='青葉編集室（架空）';
 taxChange(s,a,1,'exclusive');
 const withholding=s.find(`${a}の源泉徴収額`);withholding.value='5105';withholding.oninput();
 assert.deepEqual(s.summary(a).slice(1,4),['¥49,895','¥5,105','¥55,000']);
 s.addRow(0);let type=s.find(`${a}の2行目の報酬タイプ`);type.value='travel';type.onchange();
 amountChange(s,a,2,'1250','交通費（円）');
 discountChange(s,a,1,'apply');
 assert.deepEqual(s.summary(a),[a,'¥50,045','¥5,105','¥55,150','¥50,000','¥1,250','¥51,137','¥5,113','¥1,100']);
 assert.deepEqual(s.summary('全社合計'),['全社合計','¥74,045','¥5,105','¥79,150','¥74,000','¥1,250','¥72,956','¥7,294','¥1,100']);
 assert.equal(s.summary('こもれび企画（架空）')[1],'¥24,000');
 const input=s.find(`${a}の源泉徴収額`);input.value='60000';input.oninput();assert.equal(s.summary(a)[1],'-¥4,850');
 input.value='';input.oninput();assert.equal(s.summary(a)[1],'¥55,150');
});
test('S15-M03：追加会社と空明細を反映し、請求済・入金済で集計額を変えない',()=>{
 const s=screen(),a='追加会社（架空）';s.addCompany();
 assert.deepEqual(s.summary(a),[a,'¥0','¥0','¥0','¥0','¥0','¥0','¥0','¥0']);
 amountChange(s,a,1,'1000');s.addRow(2);
 const before=s.summary('全社合計');assert.equal(before[1],'¥75,100');
 for(const label of ['請求済','入金済']){const check=s.find(`${a}の${label}`);check.checked=true;check.onchange();assert.deepEqual(s.summary('全社合計'),before);}
 assert.equal(s.summary(a)[1],'¥1,100');
});
test('S15-M04：計算不備があれば会社・全社で古い金額を隠し、訂正すると復帰する',()=>{
 const s=screen(),a='青葉編集室（架空）',b='こもれび企画（架空）';
 const input=s.find(`${a}の源泉徴収額`);input.value='5105';input.oninput();
 discountChange(s,a,1,'apply');discountRateChange(s,a,1,'');
 for(const name of [a,'全社合計']){assert.equal(s.summary(name)[3],'入力を確認');assert.equal(s.summary(name)[1],'入力を確認');assert.equal(s.summary(name)[2],'¥5,105');}
 assert.equal(s.summary(b)[1],'¥24,000');
 discountChange(s,a,1,'none');assert.equal(s.summary('全社合計')[1],'¥68,895');
 let type=s.find(`${b}の1行目の報酬タイプ`);type.value='hourly';type.onchange();
 const hours=s.find(`${b}の1行目の時間`);hours.value='1000000000';hours.oninput();
 assert.equal(s.summary(b)[3],'入力を確認');assert.equal(s.summary('全社合計')[1],'入力を確認');
 hours.value='8';hours.oninput();assert.equal(s.summary('全社合計')[1],'¥68,895');
});
test('S15-M05：税と値引きは各会社の丸め後の小計を合算する',()=>{
 const s=screen(),names=['青葉編集室（架空）','こもれび企画（架空）'];
 for(const name of names){const type=s.find(`${name}の1行目の報酬タイプ`);type.value='per_item';type.onchange();amountChange(s,name,1,'5');taxChange(s,name,1,'exclusive');}
 assert.equal(s.summary('全社合計')[3],'¥10');
 for(const name of names){amountChange(s,name,1,'75');discountChange(s,name,1,'apply');discountRateChange(s,name,1,'2');assert.equal(s.summary(name)[3],'¥81');}
 assert.equal(s.summary('全社合計')[3],'¥162');
});
test('S15-M06：集計は会社カード下部の読み取り専用表で、表内スクロールと固定保存欄を維持する',()=>{
 const html=fs.readFileSync(__dirname+'/multiple-companies.html','utf8');
 assert.ok(html.indexOf('id="mc-summary"')>html.indexOf('id="mc-list"'));
 const s=screen();assert.ok(s.find('当月の会社別集計'));
 const row=s.find('全社合計の月次集計');assert.ok(row);assert.equal(row.children.some(n=>n.tagName==='input'),false);
 assert.match(html,/\.monthly-summary \.table-scroll/);assert.match(html,/class="save-bar"/);
});

test('S15-M07：会社見出しと同じ順で税抜・消費税・値引きを並べ、丸め後の値を合算する',()=>{
 const s=screen(),a='青葉編集室（架空）',b='こもれび企画（架空）';
 const table=s.find('当月の会社別集計');
 assert.deepEqual(table.children[0].children[0].children.map(n=>n.textContent),['会社名','ステータス','請求額','源泉徴収額','小計','報酬額','交通費','税抜合計','消費税','値引き']);
 for(const name of [a,b]){const type=s.find(`${name}の1行目の報酬タイプ`);type.value='per_item';type.onchange();amountChange(s,name,1,'75');taxChange(s,name,1,'exclusive');discountChange(s,name,1,'apply');discountRateChange(s,name,1,'2');}
 assert.deepEqual(s.summary(a).slice(6),['¥75','¥7','¥1']);
 assert.deepEqual(s.summary('全社合計').slice(6),['¥150','¥14','¥2']);
 discountRateChange(s,a,1,'');
 assert.deepEqual(s.summary(a).slice(6),['入力を確認','入力を確認','入力を確認']);
 assert.deepEqual(s.summary('全社合計').slice(6),['入力を確認','入力を確認','入力を確認']);
 discountChange(s,a,1,'none');assert.deepEqual(s.summary('全社合計').slice(6),['¥150','¥14','¥1']);
});

test('S15-M08：会社名の隣のステータスはカードのチェック・解除に連動し、金額を変えない',()=>{
 const s=screen(),a='青葉編集室（架空）',b='こもれび企画（架空）';
 const amounts=s.summary('全社合計');
 assert.equal(s.summaryStatus(a),'請求前');assert.equal(s.summaryStatus(b),'請求前');assert.equal(s.summaryStatus('全社合計'),'—');
 for(const [label,checked,expected] of [['請求済',true,'請求済'],['入金済',true,'入金済み'],['入金済',false,'請求済'],['請求済',false,'請求前']]){
  const check=s.find(`${a}の${label}`);check.checked=checked;check.onchange();
  assert.equal(s.summaryStatus(a),expected);assert.equal(s.summaryStatus(b),'請求前');assert.deepEqual(s.summary('全社合計'),amounts);
 }
 s.addCompany();assert.equal(s.summaryStatus('追加会社（架空）'),'請求前');
 assert.equal(s.find(`${a}の月次集計`).children[1].tagName,'td');
});


// S27：保存済み前月からのコピーを画面操作で検証する。
const blue='青葉編集室（架空）',green='こもれび企画（架空）';
const change=(s,company,row,key,value,event='oninput')=>{const input=s.find(`${company}の${row}行目の${key}`);assert.ok(input,key);input.value=value;input[event]();};
const copyButton=(s,company)=>{const b=s.find(`${company}の前月からコピー`);assert.ok(b,'会社別の前月からコピー');return b;};
const copyNote=(s,company)=>s.find(`${company}のコピー結果`).textContent;
test('S27-M01/T01：報酬条件をコピーし、交通費・源泉額・チェックは引き継がない',()=>{
 const s=screen('2026-11-02');
 change(s,blue,1,'税込／税抜','exclusive','onchange');change(s,blue,1,'値引き','apply','onchange');change(s,blue,1,'値引き率（%）','1.3');
 let check=s.find(`${blue}の1行目の源泉徴収あり`);check.checked=true;check.onchange();
 s.addRow(0);change(s,blue,2,'業務内容','時給の校正');change(s,blue,2,'報酬タイプ','hourly','onchange');change(s,blue,2,'時間','1.5');change(s,blue,2,'単価（円）','3001');
 s.addRow(0);change(s,blue,3,'報酬タイプ','travel','onchange');change(s,blue,3,'業務内容','前月の交通費');change(s,blue,3,'交通費（円）','1200');
 const sourceAmount=s.find(`${blue}の源泉徴収額`);sourceAmount.onfocus();sourceAmount.value='5105';sourceAmount.oninput();
 check=s.find(`${blue}の請求済`);check.checked=true;check.onchange();check=s.find(`${blue}の入金済`);check.checked=true;check.onchange();s.save();
 s.next();assert.equal(s.find(`${blue}の1行目の業務内容`).value,'');
 const targetAmount=s.find(`${blue}の源泉徴収額`);targetAmount.onfocus();targetAmount.value='123';targetAmount.oninput();
 copyButton(s,blue).onclick();assert.equal(s.find(`${blue}の1行目の業務内容`).value,'採用インタビューの原稿作成');
 assert.equal(s.find(`${blue}の1行目の報酬額（円）`).value,'50,000');assert.equal(s.find(`${blue}の1行目の税込／税抜`).value,'exclusive');
 assert.equal(s.find(`${blue}の1行目の値引き`).value,'apply');assert.equal(s.find(`${blue}の1行目の値引き率（%）`).value,'1.3');assert.equal(s.find(`${blue}の1行目の源泉徴収あり`).checked,true);
 assert.equal(s.find(`${blue}の2行目の報酬タイプ`).value,'hourly');assert.equal(s.find(`${blue}の2行目の時間`).value,'1.5');assert.equal(s.find(`${blue}の2行目の単価（円）`).value,'3001');assert.equal(s.find(`${blue}の2行目の報酬額（円）`).value,'4,502');
 assert.equal(s.find(`${blue}の3行目の業務内容`),undefined);assert.equal(s.find(`${blue}の源泉徴収額`).value,'123');assert.equal(s.status(0),'未請求');
 assert.match(copyNote(s,blue),/2026年11月.*2件/);assert.match(s.saveStatus(),/未保存/);
});
test('S27-M02：既存明細と再操作を保護し、途中入力や0円でもコピーしない',()=>{
 const s=screen('2026-11-02');assert.equal(copyButton(s,blue).disabled,true);assert.match(copyNote(s,blue),/明細/);
 s.next();const old=copyButton(s,blue);assert.equal(old.disabled,false);old.onclick();const total=s.total(0);assert.equal(copyButton(s,blue).disabled,true);old.onclick();assert.equal(s.total(0),total);assert.equal(s.find(`${blue}の2行目の業務内容`),undefined);
 for(const [key,value,event] of [['業務内容','入力途中','oninput'],['報酬額（円）','0','oninput'],['報酬タイプ','hourly','onchange'],['値引き','apply','onchange']]){
  const t=screen('2026-11-02');t.next();change(t,blue,1,key,value,event);assert.equal(copyButton(t,blue).disabled,true,key);copyButton(t,blue).onclick();assert.equal(t.find(`${blue}の1行目の${key}`).value,value);
 }
});
test('S27-M03：空の月でも請求済・入金済ならコピーできない',()=>{
 const s=screen('2026-11-02');s.next();let check=s.find(`${blue}の請求済`);check.checked=true;check.onchange();assert.equal(copyButton(s,blue).disabled,true);assert.match(copyNote(s,blue),/請求済/);
 copyButton(s,blue).onclick();assert.equal(s.find(`${blue}の1行目の業務内容`).value,'');check=s.find(`${blue}の入金済`);check.checked=true;check.onchange();assert.equal(copyButton(s,blue).disabled,true);
 check=s.find(`${blue}の入金済`);check.checked=false;check.onchange();check=s.find(`${blue}の請求済`);check.checked=false;check.onchange();assert.equal(copyButton(s,blue).disabled,false);
});
test('S27-M04：前月データなし・交通費のみ・新規会社でも入力を変えず案内する',()=>{
 const s=screen('2026-11-02');s.next();s.next();copyButton(s,blue).onclick();assert.match(copyNote(s,blue),/報酬明細.*ありません/);assert.equal(s.find(`${blue}の1行目の業務内容`).value,'');assert.doesNotMatch(s.saveStatus(),/未保存/);
 const t=screen('2026-11-02');change(t,blue,1,'報酬タイプ','travel','onchange');t.save();t.next();copyButton(t,blue).onclick();assert.match(copyNote(t,blue),/報酬明細.*ありません/);assert.equal(t.total(0),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
 t.addCompany();copyButton(t,'追加会社（架空）').onclick();assert.match(copyNote(t,'追加会社（架空）'),/報酬明細.*ありません/);
});
test('S27-M05：他社の未保存入力を保持し、編集・全社保存・月往復でも元明細は不変',()=>{
 const s=screen('2026-11-02');s.next();change(s,green,1,'業務内容','他社の未保存記事');change(s,green,1,'報酬額（円）','900');copyButton(s,blue).onclick();
 assert.equal(s.find(`${green}の1行目の業務内容`).value,'他社の未保存記事');assert.equal(s.find(`${green}の1行目の報酬額（円）`).value,'900');
 change(s,blue,1,'報酬額（円）','60000');s.save();assert.doesNotMatch(s.saveStatus(),/未保存/);s.prev();assert.equal(s.find(`${blue}の1行目の報酬額（円）`).value,'50,000');assert.equal(s.find(`${green}の1行目の業務内容`).value,'広報記事の編集');
 s.next();assert.equal(s.find(`${blue}の1行目の報酬額（円）`).value,'60,000');assert.equal(s.find(`${green}の1行目の業務内容`).value,'他社の未保存記事');assert.equal(s.summary(blue)[4],'¥60,000');
});
test('S27-T02/T03：1月は前年12月を参照し、月切替だけではコピーしない',()=>{
 const s=screen('2026-12-02');s.next();assert.equal(s.period(),'2027年度／1月');assert.equal(s.find(`${blue}の1行目の業務内容`).value,'');assert.equal(s.total(0),'小計 ¥0 / 報酬額 ¥0 / 交通費 ¥0');
 copyButton(s,blue).onclick();assert.match(copyNote(s,blue),/2026年12月/);assert.equal(s.find(`${blue}の1行目の報酬額（円）`).value,'50,000');
 const t=screen('2027-01-02');t.prev();assert.equal(t.period(),'2026年度／12月');t.next();assert.equal(t.period(),'2027年度／1月');assert.equal(t.find(`${blue}の1行目の業務内容`).value,'採用インタビューの原稿作成');
});
test('S27-M06：月切替中止と保存エラーは入力を保持し、訂正後に保存できる',()=>{
 const s=screen('2026-11-02');s.next();copyButton(s,blue).onclick();change(s,green,1,'業務内容','未入力金額の行');s.next();s.cancel();assert.equal(s.period(),'2026年度／12月');assert.equal(s.find(`${blue}の1行目の報酬額（円）`).value,'50,000');
 s.save();assert.match(s.saveStatus(),/業務内容.*金額/);assert.equal(s.find(`${green}の1行目の業務内容`).value,'未入力金額の行');
 s.next();s.saveAndSwitch();assert.match(s.switchError(),/業務内容.*金額/);assert.equal(s.period(),'2026年度／12月');s.cancel();change(s,green,1,'報酬額（円）','1000');s.save();s.next();s.prev();assert.equal(s.find(`${green}の1行目の報酬額（円）`).value,'1,000');
});
test('S27-M06：未保存の月切替で保存・破棄を選べ、前月には保存済みの内容だけ使う',()=>{
 const s=screen('2026-11-02');s.next();copyButton(s,blue).onclick();s.next();s.saveAndSwitch();assert.equal(s.period(),'2027年度／1月');copyButton(s,blue).onclick();assert.equal(s.find(`${blue}の1行目の報酬額（円）`).value,'50,000');
 s.prev();s.discard();assert.equal(s.period(),'2026年度／12月');change(s,blue,1,'報酬額（円）','100');s.next();s.discard();copyButton(s,blue).onclick();assert.equal(s.find(`${blue}の1行目の報酬額（円）`).value,'50,000');
});

test('S27-M04：9月の空行を10月の既定値引き率との違いだけでコピーしない',()=>{
 const s=screen('2026-08-02');s.next();change(s,green,1,'業務内容','9月の記事');change(s,green,1,'報酬額（円）','1000');s.save();s.next();copyButton(s,blue).onclick();
 assert.match(copyNote(s,blue),/報酬明細.*ありません/);assert.equal(s.find(`${blue}の1行目の業務内容`).value,'');assert.doesNotMatch(s.saveStatus(),/未保存/);
});
