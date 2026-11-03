ALTER TABLE billable_items ADD COLUMN reward_type TEXT NOT NULL DEFAULT 'per_item' CHECK(reward_type IN('per_item','hourly'));
ALTER TABLE billable_items ADD COLUMN hours_text TEXT NOT NULL DEFAULT '';
ALTER TABLE billable_items ADD COLUMN rate_text TEXT NOT NULL DEFAULT '';
ALTER TABLE billable_items ADD COLUMN manual_amount_yen INTEGER CHECK(manual_amount_yen IS NULL OR manual_amount_yen BETWEEN 0 AND 999999999);
ALTER TABLE invoice_lines ADD COLUMN reward_type TEXT NOT NULL DEFAULT 'per_item' CHECK(reward_type IN('per_item','hourly'));
ALTER TABLE invoice_lines ADD COLUMN hours_text TEXT NOT NULL DEFAULT '';
ALTER TABLE invoice_lines ADD COLUMN rate_text TEXT NOT NULL DEFAULT '';
PRAGMA user_version=2;
