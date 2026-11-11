-- What the app calls a match's round when it isn't BE's own: "Group match k" for a group (round-robin)
-- match, numbered in the order its side played (lib/group-rounds.js). NULL = show `round`.
-- Filled when the server starts, after each import and when players are starred.

ALTER TABLE matches ADD COLUMN round_label TEXT;
