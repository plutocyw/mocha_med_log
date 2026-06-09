CREATE TABLE IF NOT EXISTS schedule_overrides (
  slot_date TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (slot_date, slot_key)
);

CREATE TABLE IF NOT EXISTS skipped_slots (
  slot_date TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (slot_date, slot_key)
);
