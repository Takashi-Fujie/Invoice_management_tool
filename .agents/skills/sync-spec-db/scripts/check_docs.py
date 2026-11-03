#!/usr/bin/env python3
"""このプロジェクトの仕様ID・DB資料・閲覧HTML・ローカルリンクを照合する。"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import unquote, urlsplit

SPEC = 'docs/要求仕様書.md'
STATE = 'docs/仕様管理.md'
DB_DOC = 'docs/ER図とデータ設計.md'
LINK_DOCS = [SPEC, STATE, DB_DOC, 'README.md', 'docs/技術構成案.md',
             'docs/業務フロー.md', 'docs/バックアップ復元仕様.md', 'docs/DB移行と復元.md']


class CheckError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise CheckError(message)


def read(root, name):
    path = root / name
    require(path.is_file(), f'必要な資料がありません: {name}')
    return path.read_text(encoding='utf-8')


def identifiers(text):
    return re.findall(r'^\| ([A-Z][A-Z0-9-]*[0-9]) \|', text, re.M)


def id_snapshot(root):
    return {name: identifiers(read(root, name)) for name in [SPEC, STATE]}


def check_ids(snapshot, baseline):
    for name, ids in snapshot.items():
        duplicates = sorted(k for k, n in Counter(ids).items() if n > 1)
        require(not duplicates, f'IDの重複: {name}: {", ".join(duplicates)}')
        if baseline is not None:
            require(name in baseline and isinstance(baseline[name], list)
                    and all(isinstance(i, str) for i in baseline[name]), 'ID基準ファイルの形式を確認してください')
            removed = sorted(set(baseline[name]) - set(ids))
            require(not removed, f'着手前から削除されたID: {name}: {", ".join(removed)}')


def check_links(root):
    for name in LINK_DOCS:
        text = read(root, name)
        # Code examples are not links in the rendered document.
        text = re.sub(r'```.*?```', '', text, flags=re.S)
        for target in re.findall(r'\]\(([^)]+)\)', text):
            target = target.strip().strip('<>')
            url = urlsplit(target)
            if url.scheme or url.netloc or not url.path:
                continue
            path = (root / name).parent / unquote(url.path)
            require(path.exists(), f'ローカルリンクの参照先がありません: {name}: {target}')


def memory_db():
    db = sqlite3.connect(':memory:')
    # Even a future migration must never open, attach, or VACUUM INTO a file DB.
    db.set_authorizer(lambda action, *_: sqlite3.SQLITE_DENY
                      if action == sqlite3.SQLITE_ATTACH else sqlite3.SQLITE_OK)
    db.execute('PRAGMA foreign_keys=ON')
    return db


def normalize_sql(sql):
    # SQLite adds quotes to the table name after ALTER TABLE RENAME.
    # Ignore that spelling difference only in the CREATE TABLE header.
    sql = re.sub(r'(?i)^(CREATE\s+TABLE\s+)"([A-Za-z_]\w*)"', r'\1\2', sql or '')
    sql = re.sub(r'(?i)(REFERENCES\s+)"([A-Za-z_]\w*)"', r'\1\2', sql)
    # Preserve spaces inside string literals and other quoted identifiers.
    return re.sub(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|\s+",
                  lambda m: m[0] if m[0][0] in "'\"" else '', sql or '')


def db_schema(db):
    tables = {}
    objects = {}
    for kind, name, sql in db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"):
        objects[(kind, name)] = normalize_sql(sql)
        if kind != 'table':
            continue
        require(re.fullmatch(r'[A-Za-z_]\w*', name), '照合スクリプトが未対応のテーブル名です')
        columns = list(db.execute(f'PRAGMA table_info({name})'))
        indexes = {}
        for row in db.execute(f'PRAGMA index_list({name})'):
            # Index names come from SQLite, quoted as SQL identifiers.
            quoted = '"' + row[1].replace('"', '""') + '"'
            indexes[row[1]] = (row[2], row[3], tuple(r[2] for r in db.execute(f'PRAGMA index_info({quoted})')))
        tables[name] = {'columns': columns, 'foreign_keys': list(db.execute(f'PRAGMA foreign_key_list({name})')),
                        'indexes': indexes}
    return {'tables': tables, 'objects': objects}


def apply_sql(db, sql, label):
    try:
        db.executescript(sql)
    except sqlite3.Error:
        # Do not echo SQL, inserted values, or DB contents in an error.
        raise CheckError(f'SQLの適用失敗またはファイルDB操作の禁止: {label}') from None


def check_db(root):
    source = read(root, DB_DOC)
    # The first ER is the current physical schema. Future design is not a source of actual columns.
    current = source.split('### 将来の論理設計案', 1)[0]
    version = re.search(r'user_version\s*=\s*(\d+)', current)
    require(version is not None, 'DB資料に現行user_versionがありません')
    migrations = sorted((root / 'server').glob('[0-9][0-9][0-9]-*.sql'))
    require(bool(migrations), 'マイグレーションがありません')
    actual_db, doc_db = memory_db(), memory_db()
    try:
        for file in migrations:
            apply_sql(actual_db, file.read_text(encoding='utf-8'), file.name)
        require(actual_db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', '空DBの整合性検査に失敗')
        require(not actual_db.execute('PRAGMA foreign_key_check').fetchall(), '空DBの外部キー検査に失敗')
        require(actual_db.execute('PRAGMA user_version').fetchone()[0] == int(version[1]), 'DB資料のスキーマ版が不一致')
        ddls = re.findall(r'```sql\s*\n(.*?)```', current, re.S)
        require(bool(ddls), 'DB資料に現行DDLがありません')
        for sql in ddls:
            apply_sql(doc_db, sql, DB_DOC)
        actual, documented = db_schema(actual_db), db_schema(doc_db)
        require(actual == documented, 'マイグレーションとDB資料のDDL・型・NULL・既定値・制約・索引が不一致')
    finally:
        actual_db.close()
        doc_db.close()

    er = re.search(r'```mermaid\s*\nerDiagram\n(.*?)```', current, re.S)
    require(er is not None, '現行ERがありません')
    fields = {name: [line.split() for line in body.strip().splitlines()]
              for name, body in re.findall(r'(\w+)(?:\["[^"]+"\])? \{\n(.*?)\n    \}', er[1], re.S)}
    tables = actual['tables']
    require(set(fields) == set(tables), '現行ERのテーブルが物理DBと不一致')
    meta_by_table = {}
    expected_edges = set()
    expected_indexes = set()
    for name, table in tables.items():
        require([(r[0], r[1]) for r in fields[name]] == [(c[2], c[1]) for c in table['columns']],
                f'現行ERの列・型が不一致: {name}')
        section = re.search(r'### ' + name + r'（[^）]+）\n(.*?)(?=\n##|\Z)', current, re.S)
        require(section is not None, f'項目表がありません: {name}')
        metadata = {}
        for line in section[1].splitlines():
            cells = [cell.strip() for cell in line.strip('|').split('|')]
            if len(cells) == 5 and cells[0] not in ['列名', '---']:
                metadata[cells[0]] = cells[1:]
        require(set(metadata) == {c[1] for c in table['columns']}, f'項目表の列が不一致: {name}')
        for col, field in zip(table['columns'], fields[name]):
            require(metadata[col[1]][:3] == [col[2], '不可' if col[3] else '可',
                    'なし' if col[4] is None else f'`{col[4]}`'], f'項目表の型・NULL・既定値が不一致: {name}.{col[1]}')
            keys = set(field[2].split(',')) if len(field) > 2 else set()
            expected = {'PK'} if col[5] else set()
            if any(f[3] == col[1] for f in table['foreign_keys']):
                expected.add('FK')
            if any(i[1] == 'u' and i[2] == (col[1],) for i in table['indexes'].values()):
                expected.add('UK')
            require(keys == expected, f'ERのキー指定が不一致: {name}.{col[1]}')
        meta_by_table[name] = metadata
        groups = {}
        for fk in table['foreign_keys']:
            groups.setdefault(fk[0], []).append(fk)
        for group in groups.values():
            cols = tuple(fk[3] for fk in sorted(group, key=lambda f: f[1]))
            parent = '||' if all(c[3] for c in table['columns'] if c[1] in cols) else 'o|'
            children = 'o|' if any(i[0] and i[2] == cols for i in table['indexes'].values()) else 'o{'
            expected_edges.add((group[0][2], parent, children, name))
        for index, data in table['indexes'].items():
            require(data[1] in ['pk', 'u'], '手動索引は項目表の形式への対応を追加してから照合してください')
            expected_indexes.add((name, index, '主キー' if data[1] == 'pk' else '一意', ', '.join(data[2])))
    edges = set(re.findall(r'(\w+)\s+(\|\||o\|)--(o\{|o\|)\s+(\w+)\s*:', er[1]))
    require(edges == expected_edges, '現行ERの関連・多重度が不一致')
    index_rows = set()
    for line in current.splitlines():
        cells = tuple(cell.strip() for cell in line.strip('|').split('|'))
        if line.startswith('|') and len(cells) == 4 and cells[0] in tables:
            index_rows.add(cells)
    require(index_rows == expected_indexes, 'DB資料の索引一覧が不一致')

    viewer = read(root, 'docs/ER閲覧.html')
    model_match = re.search(r'const models=(.*);', viewer)
    require(model_match is not None, '閲覧HTMLのモデル形式が未対応です')
    model = json.loads(model_match[1])
    require(set(model) == {'current'} and set(model['current']['tables']) == set(tables), '閲覧HTMLの現行テーブルが不一致')
    for name, table in model['current']['tables'].items():
        require(table['fields'] == fields[name], f'閲覧HTMLの列・型・キーが不一致: {name}')
        expected_meta = {col: {'nullable': m[1], 'default': m[2].replace('`', ''), 'description': m[3]}
                         for col, m in meta_by_table[name].items()}
        require(table['metadata'] == expected_meta, f'閲覧HTMLの項目定義が不一致: {name}')
    viewer_edges = {(e['from'], '||' if e['parent'] == '1' else 'o|',
                     'o{' if e['children'] == '0件以上' else 'o|', e['to']) for e in model['current']['edges']}
    require(viewer_edges == expected_edges, '閲覧HTMLの関連・多重度が不一致')
    return len(tables), sum(len(t['columns']) for t in tables.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[4])
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--snapshot-ids', action='store_true', help='変更前のIDだけをJSONで標準出力へ出す')
    modes.add_argument('--baseline-ids', type=Path, help='変更前のJSONと比較し、ID削除も検出する')
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        snapshot = id_snapshot(root)
        if args.snapshot_ids:
            check_ids(snapshot, None)
            print(json.dumps(snapshot, ensure_ascii=False, indent=2))
            return 0
        baseline = json.loads(args.baseline_ids.read_text(encoding='utf-8')) if args.baseline_ids else None
        check_ids(snapshot, baseline)
        check_links(root)
        tables, columns = check_db(root)
        print(f'成功: IDの一意性・ローカルリンク・DB定義・ER・項目表・索引・閲覧HTML（{tables}表・{columns}列）')
        print('仕様と業務動作の一致、承認・レビュー、図の視認性は別途確認してください。')
        return 0
    except (CheckError, OSError, ValueError, KeyError, TypeError) as error:
        print(f'確認失敗: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
