-- A tournament marked complete (for example when some matches were never
-- filmed): its card and progress are no longer highlighted as unfinished.

ALTER TABLE tournaments ADD COLUMN completed_at TEXT;
