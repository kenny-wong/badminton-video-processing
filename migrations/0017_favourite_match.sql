-- A favourite match (★ on the player and tournament pages and in the editor),
-- kept on the whole match's row: 1, or NULL when it isn't one.

ALTER TABLE matches ADD COLUMN favourite INTEGER;
