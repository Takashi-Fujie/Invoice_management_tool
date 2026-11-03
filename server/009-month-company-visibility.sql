CREATE TABLE client_month_visibility (
  client_id TEXT NOT NULL REFERENCES clients(id),
  target_year INTEGER NOT NULL CHECK(target_year BETWEEN 1 AND 9999),
  target_month INTEGER NOT NULL CHECK(target_month BETWEEN 1 AND 12),
  visible INTEGER NOT NULL DEFAULT 0 CHECK(visible IN(0,1)),
  PRIMARY KEY(client_id,target_year,target_month)
);
PRAGMA user_version=9;
