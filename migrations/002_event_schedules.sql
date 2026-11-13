ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS schedule_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_names text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS schedule_error text,
  ADD COLUMN IF NOT EXISTS retired_schedule_names text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pending_config jsonb,
  ADD COLUMN IF NOT EXISTS pending_revision integer,
  ADD COLUMN IF NOT EXISTS pending_schedule_names text[];

UPDATE stores
SET schedule_status = CASE WHEN enabled THEN 'pending' ELSE 'disabled' END
WHERE schedule_revision = 0;
