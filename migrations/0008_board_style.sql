-- A match's own scoreboard look ({ preset?, corner? }, see public/shared/board.js),
-- over the one in Settings; NULL uses Settings.

ALTER TABLE matches ADD COLUMN board_style TEXT;
