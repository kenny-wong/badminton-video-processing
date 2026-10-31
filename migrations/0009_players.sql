-- Players from badminfo: everyone entered in an imported tournament (name,
-- grades and ratings from the tournament's own data), and, for players whose
-- profile has been read, their county and matches with badminfo's win chances.
-- tournament_players ties each name in a tournament's draws to its player.

CREATE TABLE players (
  id TEXT PRIMARY KEY,                -- badminfo id
  name TEXT NOT NULL,
  be_number TEXT,
  county TEXT,
  grades TEXT,                        -- JSON { singles, doubles, mixed }
  ratings TEXT,                       -- JSON { singles, doubles, mixed }
  ratings_date TEXT,
  rubbers TEXT,                       -- JSON, from the profile (lib/badminfo.js playerProfile)
  fetched_at TEXT,                    -- when the profile was last read; NULL when known only from a draw
  seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,  -- as entered, the same as in the draws
  player_id TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY (tournament_id, name)
);
CREATE INDEX tournament_players_player ON tournament_players (player_id);
