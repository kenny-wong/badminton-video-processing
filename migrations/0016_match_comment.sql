-- A comment on a match or one game of it, typed in the editor; it goes at the
-- end of the YouTube description of that match's (or game's) videos.

ALTER TABLE matches ADD COLUMN comment TEXT;
