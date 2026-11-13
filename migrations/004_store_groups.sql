ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS owner_group text;

ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_owner_group_check;

ALTER TABLE stores
  ADD CONSTRAINT stores_owner_group_check
  CHECK (owner_group IS NULL OR owner_group IN ('oz1', 'oz2', 'oz3', 'oz4', 'oz5'));

CREATE INDEX IF NOT EXISTS stores_owner_group_created
  ON stores(owner_group, created_at);
