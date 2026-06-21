CREATE TABLE IF NOT EXISTS seizure_events (
  id TEXT PRIMARY KEY,
  occurred_on TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_seizure_events_date ON seizure_events(occurred_on DESC);

INSERT OR IGNORE INTO seizure_events (id, occurred_on, notes, created_at, created_by_user_id)
VALUES
  ('historical-2025-05-10', '2025-05-10', NULL, '2026-06-21T00:00:00.000Z', NULL),
  ('historical-2025-10-07', '2025-10-07', NULL, '2026-06-21T00:00:00.000Z', NULL),
  ('historical-2026-01-10', '2026-01-10', NULL, '2026-06-21T00:00:00.000Z', NULL),
  ('historical-2026-04-09', '2026-04-09', NULL, '2026-06-21T00:00:00.000Z', NULL),
  ('historical-2026-05-11', '2026-05-11', NULL, '2026-06-21T00:00:00.000Z', NULL),
  ('historical-2026-05-23', '2026-05-23', NULL, '2026-06-21T00:00:00.000Z', NULL);
