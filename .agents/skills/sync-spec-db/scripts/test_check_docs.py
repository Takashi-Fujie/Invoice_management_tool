"""架空の資料とスキーマで、食い違いの検出と読取専用の境界を検証する。"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CHECKER = Path(__file__).with_name('check_docs.py')


class DocumentChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'docs').mkdir()
        (self.root / 'server').mkdir()
        for name in ['README.md', 'docs/技術構成案.md', 'docs/業務フロー.md', 'docs/バックアップ復元仕様.md', 'docs/DB移行と復元.md']:
            (self.root / name).write_text('# 架空の補助資料\n')
        (self.root / '.local-data').mkdir()
        self.live = self.root / '.local-data/invoice.sqlite'
        self.live.write_bytes(b'This is a protected fake local DB; do not open it.')
        self.ddl = 'CREATE TABLE clients(id TEXT PRIMARY KEY, amount INTEGER NOT NULL DEFAULT 0 CHECK(amount>=0));'
        (self.root / 'server/001-test.sql').write_text(self.ddl + '\nPRAGMA user_version=1;')
        (self.root / 'docs/要求仕様書.md').write_text('| ID | 確認 | 条件 |\n|---|---|---|\n| F01 | 入力 | 金額 |\n| A01 | 保存 | 保持 |\n')
        (self.root / 'docs/仕様管理.md').write_text('| ID | 状態 |\n|---|---|\n| S01 | 実装中 |\n')
        self.dbdoc = self.root / 'docs/ER図とデータ設計.md'
        self.dbdoc.write_text('''# テスト用DB資料
版：1
PRAGMA user_version=1
[仕様](要求仕様書.md)
```mermaid
erDiagram
    clients["架空の会社"] {
        TEXT id PK
        INTEGER amount
    }
```
### clients（架空の会社）
| 列名 | 型 | NULL可否 | 既定値 | 内容 |
|---|---|---|---|---|
| id | TEXT | 可 | なし | ID |
| amount | INTEGER | 不可 | `0` | 円 |
## DB制約
```sql
''' + self.ddl + '''
```
| テーブル | 索引名 | 種別 | 列 |
|---|---|---|---|
| clients | sqlite_autoindex_clients_1 | 主キー | id |
''')
        self.viewer = self.root / 'docs/ER閲覧.html'
        self.viewer.write_text('const models=' + json.dumps({'current': {'tables': {'clients': {
            'fields': [['TEXT', 'id', 'PK'], ['INTEGER', 'amount']],
            'metadata': {'id': {'nullable': '可', 'default': 'なし', 'description': 'ID'},
                         'amount': {'nullable': '不可', 'default': '0', 'description': '円'}}}}, 'edges': []}}) + ';')

    def run_check(self, *args):
        return subprocess.run([sys.executable, str(CHECKER), '--root', str(self.root), *args], capture_output=True, text=True)

    def mutate_doc(self, before, after):
        self.dbdoc.write_text(self.dbdoc.read_text().replace(before, after))

    def test_consistent_docs_and_local_database_are_untouched(self):
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_table_rename_quoting_does_not_change_the_schema(self):
        (self.root / 'server/001-test.sql').write_text(
            self.ddl.replace('CREATE TABLE clients', 'CREATE TABLE draft')
            + '\nALTER TABLE draft RENAME TO clients;\nPRAGMA user_version=1;')
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_pipe_characters_outside_a_markdown_table_are_not_indexes(self):
        self.dbdoc.write_text('clients ||--o| details : "参考表現"\n' + self.dbdoc.read_text())
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_missing_check_constraint_is_rejected(self):
        self.mutate_doc('CHECK(amount>=0)', '')
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_nullable_or_default_drift_is_rejected(self):
        self.mutate_doc('| id | TEXT | 可 |', '| id | TEXT | 不可 |')
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_extra_future_table_in_current_er_is_rejected(self):
        self.mutate_doc('erDiagram\n', 'erDiagram\n    future {\n        TEXT id\n    }\n')
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_stale_viewer_is_rejected(self):
        self.viewer.write_text(self.viewer.read_text().replace('"INTEGER"', '"TEXT"'))
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_duplicate_spec_id_and_broken_link_are_rejected(self):
        p = self.root / 'docs/要求仕様書.md'
        p.write_text(p.read_text() + '| A01 | 重複 | 条件 |\n')
        self.assertNotEqual(self.run_check().returncode, 0)
        p.write_text('| F01 | 入力 | 金額 |\n| A01 | 保存 | 保持 |\n')
        self.mutate_doc('(要求仕様書.md)', '(missing.md)')
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_id_removal_from_working_tree_baseline_is_rejected(self):
        snapshot = self.run_check('--snapshot-ids')
        self.assertEqual(snapshot.returncode, 0, snapshot.stderr)
        baseline = self.root / 'baseline.json'
        baseline.write_text(snapshot.stdout)
        p = self.root / 'docs/要求仕様書.md'
        p.write_text(p.read_text().replace('| A01 | 保存 | 保持 |\n', ''))
        self.assertNotEqual(self.run_check('--baseline-ids', str(baseline)).returncode, 0)

    def test_migration_cannot_attach_or_write_a_file_database(self):
        target = self.root / 'must-not-exist.sqlite'
        (self.root / 'server/001-test.sql').write_text(f"ATTACH DATABASE '{target}' AS other;")
        self.assertNotEqual(self.run_check().returncode, 0)
        self.assertFalse(target.exists())
        self.assertEqual(self.live.read_bytes(), b'This is a protected fake local DB; do not open it.')


if __name__ == '__main__':
    unittest.main()
