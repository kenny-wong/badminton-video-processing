-- Rallies filled in from the enrolment planner's recorded games (lib/planner-records.js, 2.1.0).
-- planner_records: each match or game row filled, once per video, so a tagging cleared by hand
-- isn't filled again. planner_keys: the planner's key of a match that has no YouTube link yet
-- (those with links have theirs in planner_links), or why it couldn't be told.
CREATE TABLE planner_records (
  unit_id INTEGER PRIMARY KEY,        -- the matches row (whole match or one game) whose rallies were filled
  video_id INTEGER NOT NULL,
  be_key TEXT NOT NULL,
  rallies INTEGER NOT NULL,           -- how many were placed on the video
  applied_at TEXT NOT NULL
);
CREATE TABLE planner_keys (
  match_id INTEGER PRIMARY KEY,       -- the whole match
  be_key TEXT,                        -- NULL when it couldn't be told (reason)
  sides TEXT,                         -- its two sides as badminfo has them, BV's team a first
  reason TEXT,
  looked_at TEXT NOT NULL
);
