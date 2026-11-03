ALTER TABLE billable_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'fee' CHECK(kind IN('fee','travel'));
ALTER TABLE invoice_lines ADD COLUMN kind TEXT NOT NULL DEFAULT 'fee' CHECK(kind IN('fee','travel'));
PRAGMA user_version=3;
