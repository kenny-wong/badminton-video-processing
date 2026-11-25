-- The YouTube links sent to the enrolment planner (lib/planner.js): for each match, the planner's
-- key for it and what was last sent. No foreign key: a deleted match's row stays until the planner
-- has been told its links are gone.
CREATE TABLE planner_links (
  match_id INTEGER PRIMARY KEY,         -- the whole match (its games' links are in its row)
  be_key TEXT NOT NULL,                 -- badminfo tournament id | draw number | the players' badminfo ids, sorted
  payload TEXT NOT NULL DEFAULT '',     -- {"video": url, "games": {"1": url}} as last sent; '' = to be sent again
  sent_at TEXT
);
