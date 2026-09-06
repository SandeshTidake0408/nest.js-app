CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')) DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lifetime_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  lease_token UUID,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_events_ready_idx ON webhook_events (available_at, created_at)
  WHERE status = 'pending';
CREATE INDEX webhook_events_lease_idx ON webhook_events (lease_until)
  WHERE status = 'processing';

CREATE TABLE processing_attempts (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES webhook_events(event_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  worker_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  result TEXT NOT NULL DEFAULT 'processing' CHECK (result IN ('processing', 'succeeded', 'retry', 'failed', 'abandoned')),
  error TEXT,
  UNIQUE (event_id, attempt_number)
);

CREATE TABLE processed_orders (
  event_id TEXT PRIMARY KEY REFERENCES webhook_events(event_id),
  order_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
