-- Tournaments imported from badminfo or Badminton England, their matches, the
-- video files found on disk and app settings. Lists (teams, games, rallies)
-- are JSON text. Times are ISO-8601 UTC text; booleans 1/0.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY,
  be_id TEXT NOT NULL UNIQUE,
  badminfo_id TEXT,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_date TEXT NOT NULL,          -- UK date, YYYY-MM-DD
  match_time TEXT NOT NULL,          -- UK wall clock when due on court, HH:MM
  starts_at TEXT,                    -- the same moment in UTC
  draw TEXT NOT NULL DEFAULT '',
  round TEXT NOT NULL DEFAULT '',
  court TEXT NOT NULL DEFAULT '',
  duration INTEGER,                  -- minutes, once played
  team_a TEXT NOT NULL,              -- JSON array of names
  team_b TEXT NOT NULL,
  games TEXT NOT NULL DEFAULT '[]',  -- official result, JSON [[a, b], ...]
  winner INTEGER,                    -- 1, 2 or NULL
  format TEXT,                       -- JSON { points, setting, bestOf }, NULL = guessed from the result
  first_server TEXT NOT NULL DEFAULT 'a',
  rallies TEXT NOT NULL DEFAULT '[]',-- JSON [{ start, end, winner }]
  source_path TEXT,                  -- the joined file when the match has several videos
  output_path TEXT,
  rendered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (tournament_id, draw, round, team_a, team_b)
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  recorded_at TEXT,                  -- when recording started, UTC
  recorded_source TEXT,              -- apple, filename, creation_time, modified
  duration REAL,
  width INTEGER,
  height INTEGER,
  fps REAL,
  codec TEXT,
  hdr INTEGER NOT NULL DEFAULT 0,
  has_audio INTEGER NOT NULL DEFAULT 1,
  match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  part INTEGER NOT NULL DEFAULT 1,   -- order within the match
  missing INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX matches_tournament ON matches (tournament_id, match_date, match_time);
CREATE INDEX videos_match ON videos (match_id, part);
CREATE INDEX videos_recorded ON videos (recorded_at);
