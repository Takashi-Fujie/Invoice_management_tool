"""ER設計のMermaidから、外部依存のない閲覧用HTMLを再生成する。"""
from pathlib import Path
import json
import re
import subprocess

root = Path(__file__).resolve().parents[1]
source = (root / 'ER図とデータ設計.md').read_text()
blocks = re.findall(r'```mermaid\s*\nerDiagram\n(.*?)```', source, re.S)
assert len(blocks) == 2, '現行の物理ERと将来の論理ERを確認してください'
labels = dict(client_month_visibility='月別会社表示', clients='会社',
              rate_terms='報酬条件', work_logs='稼働', billable_items='請求対象',
              invoices='月次請求', invoice_lines='請求明細', personal_payments='国保・年金')
roles = {}
for line in source.splitlines():
    match = re.match(r'\| (\w+) [^|]+\| ([^|]+)\|', line)
    if match and match[1] in labels:
        roles[match[1]] = match[2].strip()

def parse(block):
    tables = {}
    for name, fields in re.findall(r'(\w+)(?:\["[^"]+"\])? \{\n(.*?)\n    \}', block, re.S):
        rows = [line.split() for line in fields.strip().splitlines()]
        tables[name] = {'name': labels[name], 'role': roles[name], 'fields': rows}
    edges = []
    for a, ca, cb, b, verb in re.findall(r'(\w+)\s+(\|\||o\|)--(o\{|o\|)\s+(\w+)\s*:\s*([^\n]+)', block):
        edges.append({'from': a, 'to': b, 'parent': '1' if ca == '||' else '0または1',
                      'children': '0件以上' if cb == 'o{' else '0または1件'})
    return {'tables': tables, 'edges': edges}

data = {'current': parse(blocks[0])}
assert len(data['current']['tables']) == 5
assert len(data['current']['edges']) == 5
schema_version = re.search(r'user_version=(\d+)', source)[1]
table_count = len(data['current']['tables'])
column_count = sum(len(t['fields']) for t in data['current']['tables'].values())
for name, table in data['current']['tables'].items():
    section = re.search(r'### ' + name + r'（[^）]+）\n(.*?)(?=\n##|\Z)', source, re.S)[1]
    metadata = {}
    for line in section.splitlines():
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) == 5 and cells[0] not in ['列名', '---']:
            metadata[cells[0]] = {'nullable': cells[2], 'default': cells[3].replace('`', ''), 'description': cells[4]}
    assert set(metadata) == {row[1] for row in table['fields']}, name
    table['metadata'] = metadata
for edge in data['current']['edges']:
    assert edge['from'] in data['current']['tables'] and edge['to'] in data['current']['tables']
version = next(line for line in source.splitlines() if line.startswith('版：'))
html = r'''<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>請求管理システム データのつながり</title>
<style>
:root{color-scheme:light dark;--bg:light-dark(#f7f8fa,#14181f);--fg:light-dark(#19283a,#e1e8ef);--panel:light-dark(#fff,#202832);--muted:light-dark(#526174,#b0bdcc);--line:light-dark(#d8dfe8,#43505f);--accent:light-dark(#164c85,#b1d8ff);--selected:light-dark(#e6f0fc,#304661)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,'Hiragino Sans',sans-serif}main{max-width:1180px;margin:auto;padding:32px 28px}h1{font-size:26px;margin:0 0 8px}h2{font-size:21px;margin:0 0 12px}h3{font-size:17px;margin:24px 0 8px}p{margin:8px 0}small,.muted{color:var(--muted)}code{font-size:13px;overflow-wrap:anywhere}a{color:var(--accent)}.top{display:flex;gap:16px;justify-content:space-between;align-items:start;flex-wrap:wrap}.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0 12px}button{font:inherit;color:inherit;border:1px solid var(--line);background:var(--panel);padding:10px 14px;border-radius:8px;cursor:pointer;text-align:left}button[aria-pressed=true]{background:var(--selected);border-color:var(--accent)}button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.layout{display:grid;grid-template-columns:245px minmax(0,1fr);gap:24px;margin-top:24px}.tables{display:flex;flex-direction:column;gap:8px}.tables button strong,.tables button code{display:block}.detail{min-width:0;background:var(--panel);padding:24px;border-radius:12px;border:1px solid var(--line)}.relation{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.relation button{font-size:15px}.relation button strong,.relation button code{display:block}.relation small{display:block}.empty{color:var(--muted)}table{border-collapse:collapse;width:100%}th,td{padding:10px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}th{font-weight:600}td:first-child{width:55%}.note{border-left:3px solid var(--line);padding-left:14px;margin:16px 0}.overview{padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.overview p{margin:4px 0}.overview a{white-space:normal}.key{font-size:13px;color:var(--muted)}[hidden]{display:none!important}footer{margin-top:24px;font-size:13px;color:var(--muted)}@media(max-width:680px){main{padding:20px 16px}h1{font-size:22px}.layout{grid-template-columns:1fr;gap:16px}.tables{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.tables button{padding:10px}.detail{padding:16px}.relation{gap:6px}th,td{padding:8px 5px}}
@media print{body{background:white;color:black}.tabs,.tables{display:none}.layout{display:block}.detail{border:none}.relation button{border:none}main{max-width:none}}
</style>
<main>
<div class="top"><div><h1>データのつながり</h1><p class="muted">テーブルを選ぶと、関連するデータと項目を確認できます。</p></div><a href="ER図とデータ設計.md">設計文書へ</a></div>
<div class="tabs"><strong>現在の実装 · DB版8 · 4表／42列</strong><a href="ER図とデータ設計.md">将来の案・未実装範囲は設計文書へ</a></div>
<p id="scope-note" class="note"></p>
<section class="overview" aria-label="主な関係"><p><a href="#" data-select="clients">会社</a> → <a href="#" data-select="billable_items">請求対象</a> → <a href="#" data-select="invoice_lines">請求明細</a></p><p><a href="#" data-select="clients">会社</a> → <a href="#" data-select="invoices">月次請求</a> → <a href="#" data-select="invoice_lines">請求明細</a></p></section>
<div class="layout"><nav class="tables" id="table-list" aria-label="テーブル一覧"></nav><article class="detail" id="detail" aria-live="polite"></article></div>
<footer><p>PK：主キー ／ FK：参照先を持つ項目 ／ UK：重複不可。関連の件数は元のER定義に対応します。</p><p>現行の全42列を表示します。型・NULL可否・既定値は物理DBの定義です。既定値と画面の新規入力の初期値は異なります。CHECK・複合一意制約・索引・API側の保証は設計文書で確認してください。</p><p>表示用の補助資料です。仕様の正本は要求仕様書、データ設計の説明はER図とデータ設計を参照してください。</p><p id="version"></p></footer>
</main>
<script>
const models=__DATA__;
const version=__VERSION__;
let scope='current', selected='clients';
const list=document.getElementById('table-list'), detail=document.getElementById('detail');
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function tableButton(id){const t=models[scope].tables[id],b=el('button');b.type='button';b.append(el('strong',t.name),el('code',id));b.onclick=()=>{selected=id;render();};return b;}
function section(title,edges,incoming){detail.append(el('h3',title));if(!edges.length){detail.append(el('p','なし','empty'));return;}for(const e of edges){const row=el('div',undefined,'relation'),other=incoming?e.from:e.to;row.append(tableButton(other));const desc=el('div');desc.append(el('span',incoming?`この1件につき ${e.parent}件を参照`:`この1件に対し ${e.children}が関連`));row.append(desc);detail.append(row);}}
function render(){const model=models[scope];if(!model.tables[selected])selected='clients';document.getElementById('scope-note').textContent='mvp/2の作業ツリーに反映されたDB版9の物理定義です。コード反映と受入完了は区別し、完了状態は仕様管理で確認してください。';list.replaceChildren();for(const id of Object.keys(model.tables)){const b=tableButton(id);b.setAttribute('aria-pressed',String(id===selected));list.append(b);}const t=model.tables[selected];detail.replaceChildren(el('h2',t.name),el('code',selected),el('p',t.role));section('参照先',model.edges.filter(e=>e.to===selected),true);section('このテーブルを参照するデータ',model.edges.filter(e=>e.from===selected),false);detail.append(el('h3','現行の全項目（物理定義）'));const wrap=el('div');wrap.style.overflowX='auto';const tbl=el('table'),head=el('thead'),hr=el('tr');for(const label of ['列名・内容','型','NULL','既定値','キー']){const th=el('th',label);th.scope='col';hr.append(th);}head.append(hr);tbl.append(head);const body=el('tbody');for(const [type,name,key] of t.fields){const meta=t.metadata[name],tr=el('tr'),td=el('td');td.append(el('code',name),el('div',meta.description));tr.append(td,el('td',type),el('td',meta.nullable),el('td',meta.default||'空文字'),el('td',key||'—'));body.append(tr);}tbl.append(body);wrap.append(tbl);detail.append(wrap);if(selected==='invoices')detail.append(el('p','保存するtotal_yenは源泉控除前の小計。画面の請求額＝小計−手入力の源泉額。','note'));}
document.querySelectorAll('[data-select]').forEach(a=>a.onclick=e=>{e.preventDefault();selected=a.dataset.select;render();});document.getElementById('version').textContent=version;render();
</script></html>
'''
html = html.replace('__DATA__', json.dumps(data, ensure_ascii=False).replace('<', '\\u003c'))
html = html.replace('__VERSION__', json.dumps(version, ensure_ascii=False))
target = root / 'ER閲覧.html'
target.write_text(html)
dot_path = root / 'diagrams/er-overview.dot'
def quote(value):
    return json.dumps(value, ensure_ascii=False)
lines = ['// 生成元: docs/ER図とデータ設計.md。再生成: python3 docs/diagrams/build-er-viewer.py',
         'digraph ER {',
         'graph [rankdir=TB,bgcolor="#f7f9fc",pad="0.3",nodesep="0.5",ranksep="0.8",fontname="Hiragino Sans",fontsize=18,label=' + quote(f'現行の物理ER · DB版{schema_version} · {table_count}表\n' + version) + ',labelloc=t];',
         'node [shape=box,style="rounded,filled",fontname="Hiragino Sans",fontsize=13,margin="0.2,0.15",color="#bacbdd",fillcolor=white];',
         'edge [fontname="Hiragino Sans",fontsize=11,color="#68819a"];']
for name, table in data['current']['tables'].items():
    lines.append(name + ' [label=' + quote(table['name'] + '\n' + name + '\n' + str(len(table['fields'])) + '列') + '];')
for edge in data['current']['edges']:
    lines.append(edge['from'] + ' -> ' + edge['to'] + ' [label=' + quote(edge['parent'] + ' : ' + edge['children']) + '];')
lines.append('}')
dot_path.write_text('\n'.join(lines) + '\n')
subprocess.run(['dot', '-Tsvg', str(dot_path), '-o', str(root / 'ER概要図.svg')], check=True)
print(f'{target}: 現行{table_count}表・{column_count}列・{len(data["current"]["edges"])}関連とER概要図を出力')

# 期間選択と現行DBの接続も、同じ現行テーブル・関連から生成する。
period_lines = [
    '// 生成元: docs/ER図とデータ設計.md。再生成: python3 docs/diagrams/build-er-viewer.py',
    'digraph periodER {',
    'graph [rankdir=LR,bgcolor="#f7f9fc",pad="0.3",fontname="Hiragino Sans",fontsize=18,label="対象年月の画面状態と現行DB · 版9",labelloc=t];',
    'node [shape=box,style="rounded,filled",fillcolor=white,fontname="Hiragino Sans",fontsize=12,margin="0.2,0.15"];',
    'edge [fontname="Hiragino Sans",fontsize=11];',
    'subgraph cluster_state { label="画面内メモリ・DBテーブルではない";fontname="Hiragino Sans";',
    'period [label="選択中の対象年・月\\n年度は1月〜12月"];',
    'draft [label="編集開始時の年月・未保存入力\\n読取・保存の成功後に切替を確定"];',
    'period -> draft [style=dashed];}',
    'subgraph cluster_db { label="現行の5表・対象年月の参照に必要な列だけ表示";fontname="Hiragino Sans";',
]
for name, table in data['current']['tables'].items():
    fields = [row[1] for row in table['fields'] if row[1] in ['id', 'client_id', 'invoice_id', 'billable_item_id', 'target_year', 'target_month']]
    period_lines.append(name + ' [label=' + quote(table['name'] + '\n' + name + '\n' + '\n'.join(fields)) + '];')
for edge in data['current']['edges']:
    period_lines.append(edge['from'] + ' -> ' + edge['to'] + ' [label=' + quote(edge['parent'] + ' : ' + edge['children']) + '];')
period_lines.append('}')
for name in ['billable_items', 'invoices', 'client_month_visibility']:
    period_lines.append('period -> ' + name + ' [style=dashed,label="年月で絞る・FKではない"];')
period_lines.append('}')
period_dot = root / 'diagrams/s01-period-er.dot'
period_dot.write_text('\n'.join(period_lines) + '\n')
subprocess.run(['dot', '-Tsvg', str(period_dot), '-o', str(root / 'S01対象期間とER.svg')], check=True)
