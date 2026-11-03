ALTER TABLE billable_items ADD COLUMN discount_enabled INTEGER NOT NULL DEFAULT 0 CHECK(discount_enabled IN(0,1));
ALTER TABLE billable_items ADD COLUMN discount_rate TEXT NOT NULL DEFAULT '2';
UPDATE billable_items SET discount_rate='1.3' WHERE target_year<2026 OR (target_year=2026 AND target_month<10);
ALTER TABLE invoice_lines ADD COLUMN discount_enabled INTEGER NOT NULL DEFAULT 0 CHECK(discount_enabled IN(0,1));
ALTER TABLE invoice_lines ADD COLUMN discount_rate TEXT NOT NULL DEFAULT '2';
UPDATE invoice_lines SET discount_rate=(SELECT b.discount_rate FROM billable_items b WHERE b.id=invoice_lines.billable_item_id);
PRAGMA user_version=5;
