CREATE TABLE billable_items_s14 (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  target_year INTEGER NOT NULL,
  target_month INTEGER NOT NULL,
  description TEXT NOT NULL,
  amount_yen INTEGER NOT NULL CHECK((amount_yen>=0 OR kind='adjustment') AND (kind<>'adjustment' OR amount_yen BETWEEN -999999999 AND 999999999)),
  reward_type TEXT NOT NULL DEFAULT 'per_item' CHECK(reward_type IN('per_item','hourly')),
  hours_text TEXT NOT NULL DEFAULT '',
  rate_text TEXT NOT NULL DEFAULT '',
  manual_amount_yen INTEGER CHECK(manual_amount_yen IS NULL OR manual_amount_yen BETWEEN -999999999 AND 999999999),
  kind TEXT NOT NULL DEFAULT 'fee' CHECK(kind IN('fee','travel','expense','adjustment')),
  price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK(price_mode IN('inclusive','exclusive')),
  fee_price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK(fee_price_mode IN('inclusive','exclusive')),
  travel_price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK(travel_price_mode IN('inclusive','exclusive')),
  discount_enabled INTEGER NOT NULL DEFAULT 0 CHECK(discount_enabled IN(0,1)),
  discount_rate TEXT NOT NULL DEFAULT '2',
  withholding_enabled INTEGER NOT NULL DEFAULT 0 CHECK(withholding_enabled IN(0,1))
);
CREATE TABLE invoice_lines_s14 (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  billable_item_id TEXT NOT NULL UNIQUE REFERENCES billable_items_s14(id),
  line_no INTEGER NOT NULL,
  description TEXT NOT NULL,
  total_yen INTEGER NOT NULL CHECK(total_yen>=0 OR kind='adjustment'),
  reward_type TEXT NOT NULL DEFAULT 'per_item' CHECK(reward_type IN('per_item','hourly')),
  hours_text TEXT NOT NULL DEFAULT '',
  rate_text TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'fee' CHECK(kind IN('fee','travel','expense','adjustment')),
  price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK(price_mode IN('inclusive','exclusive')),
  discount_enabled INTEGER NOT NULL DEFAULT 0 CHECK(discount_enabled IN(0,1)),
  discount_rate TEXT NOT NULL DEFAULT '2',
  withholding_enabled INTEGER NOT NULL DEFAULT 0 CHECK(withholding_enabled IN(0,1)),
  UNIQUE(invoice_id,line_no)
);
INSERT INTO billable_items_s14 SELECT * FROM billable_items ORDER BY rowid;
INSERT INTO invoice_lines_s14 SELECT * FROM invoice_lines ORDER BY rowid;
DROP TABLE invoice_lines;
DROP TABLE billable_items;
ALTER TABLE billable_items_s14 RENAME TO billable_items;
ALTER TABLE invoice_lines_s14 RENAME TO invoice_lines;
PRAGMA user_version=8;
