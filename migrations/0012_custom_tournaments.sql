-- Custom tournaments, made by hand instead of imported, and a player list that
-- keeps players who are no longer starred.
--
-- tournaments is rebuilt so be_id can be empty (a custom tournament has no
-- Badminton England page); kind is 'imported' or 'custom'; venue and format
-- (JSON { points, setting, bestOf }, the scoring new matches get) are for
-- custom ones.
-- favourites.starred: 1 = a favourite (★), 0 = on the Players list only.
-- tournament_roster: the listed players assigned to a custom tournament.

CREATE TABLE tournaments_new (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'imported' CHECK (kind IN ('imported', 'custom')),
  be_id TEXT UNIQUE,
  badminfo_id TEXT,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  venue TEXT,
  format TEXT,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO tournaments_new (id, be_id, badminfo_id, name, start_date, end_date, imported_at)
SELECT id, be_id, badminfo_id, name, start_date, end_date, imported_at FROM tournaments;

DROP TABLE tournaments;
ALTER TABLE tournaments_new RENAME TO tournaments;

ALTER TABLE favourites ADD COLUMN starred INTEGER NOT NULL DEFAULT 1;

CREATE TABLE tournament_roster (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  favourite_id INTEGER NOT NULL REFERENCES favourites(id) ON DELETE CASCADE,
  PRIMARY KEY (tournament_id, favourite_id)
);
