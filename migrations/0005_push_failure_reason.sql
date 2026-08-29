-- Persist why a push was rejected. Only the timestamp was stored before, so a
-- rejection could only be diagnosed by happening to tail the logs at the moment
-- it occurred; the reason was otherwise lost.
ALTER TABLE push_subscriptions ADD COLUMN last_failure_reason TEXT;
