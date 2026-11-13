CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Moscow',
  start_time char(5) NOT NULL,
  stop_time char(5) NOT NULL,
  client_id text NOT NULL,
  secret_enc text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_action_key text,
  last_action_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  windows jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS job_runs (
  id bigserial PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  action text NOT NULL,
  status text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_runs_store_created
  ON job_runs(store_id, created_at DESC);
