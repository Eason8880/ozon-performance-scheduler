ALTER TABLE job_runs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'unknown';

UPDATE job_runs
SET source = 'state_sync'
WHERE source = 'unknown'
  AND detail = 'initial state synchronization';

UPDATE job_runs
SET source = 'scheduled'
WHERE source = 'unknown'
  AND detail LIKE 'schedule execution %';
