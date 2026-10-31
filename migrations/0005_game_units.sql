-- A match can also be filmed game by game: each game then gets its own row
-- (game 1, 2, 3; parent_id = the whole match, game 0) with its own videos,
-- tagging, render and YouTube link. SQLite can't change a UNIQUE constraint in
-- place, so the table is rebuilt (foreign keys are off while migrations run).

CREATE TABLE matches_new (
  id INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES matches(id) ON DELETE CASCADE, -- the whole match, for a game's row
  game INTEGER NOT NULL DEFAULT 0,   -- 0 = the whole match; 1-3 = one game of it
  match_date TEXT NOT NULL,
  match_time TEXT NOT NULL,
  starts_at TEXT,
  draw TEXT NOT NULL DEFAULT '',
  round TEXT NOT NULL DEFAULT '',
  court TEXT NOT NULL DEFAULT '',
  duration INTEGER,
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  games TEXT NOT NULL DEFAULT '[]',
  winner INTEGER,
  format TEXT,
  first_server TEXT NOT NULL DEFAULT 'a',
  rallies TEXT NOT NULL DEFAULT '[]',
  source_path TEXT,
  output_path TEXT,
  rendered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  youtube_url TEXT,
  uploaded_at TEXT,
  match_start REAL,
  match_end REAL,
  start_score TEXT,
  highlights_path TEXT,
  highlights_at TEXT,
  UNIQUE (tournament_id, draw, round, team_a, team_b, game)
);

INSERT INTO matches_new (id, tournament_id, match_date, match_time, starts_at, draw, round, court, duration, team_a, team_b, games, winner,
  format, first_server, rallies, source_path, output_path, rendered_at, updated_at, youtube_url, uploaded_at, match_start, match_end,
  start_score, highlights_path, highlights_at)
SELECT id, tournament_id, match_date, match_time, starts_at, draw, round, court, duration, team_a, team_b, games, winner,
  format, first_server, rallies, source_path, output_path, rendered_at, updated_at, youtube_url, uploaded_at, match_start, match_end,
  start_score, highlights_path, highlights_at
FROM matches;

DROP TABLE matches;
ALTER TABLE matches_new RENAME TO matches;

CREATE INDEX matches_tournament ON matches (tournament_id, match_date, match_time);
CREATE INDEX matches_parent ON matches (parent_id, game);
