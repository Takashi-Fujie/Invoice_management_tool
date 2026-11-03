ALTER TABLE billable_items ADD COLUMN withholding_enabled INTEGER NOT NULL DEFAULT 0 CHECK(withholding_enabled IN(0,1));
ALTER TABLE invoice_lines ADD COLUMN withholding_enabled INTEGER NOT NULL DEFAULT 0 CHECK(withholding_enabled IN(0,1));
ALTER TABLE invoices ADD COLUMN withholding_yen INTEGER NOT NULL DEFAULT 0 CHECK(withholding_yen BETWEEN 0 AND 999999999);
PRAGMA user_version=6;
