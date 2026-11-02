-- The Tools page's merged and split videos. made_from (JSON) says what a new
-- video was made from; set_aside = 1 keeps an original that was merged or
-- split out of matching (it stays on disk and in the Videos list).

ALTER TABLE videos ADD COLUMN set_aside INTEGER NOT NULL DEFAULT 0;
ALTER TABLE videos ADD COLUMN made_from TEXT;
