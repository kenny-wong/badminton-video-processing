-- A second finished video per match: only the rallies marked as favourites.

ALTER TABLE matches ADD COLUMN highlights_path TEXT;
ALTER TABLE matches ADD COLUMN highlights_at TEXT;
