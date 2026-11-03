ALTER TABLE billable_items ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK(price_mode IN('inclusive','exclusive'));
ALTER TABLE billable_items ADD COLUMN fee_price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK(fee_price_mode IN('inclusive','exclusive'));
ALTER TABLE billable_items ADD COLUMN travel_price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK(travel_price_mode IN('inclusive','exclusive'));
UPDATE billable_items SET fee_price_mode='exclusive' WHERE kind='travel';
ALTER TABLE invoice_lines ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK(price_mode IN('inclusive','exclusive'));
PRAGMA user_version=4;
