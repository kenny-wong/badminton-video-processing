-- Favourite players, starred on the Players tab, replace the "My players"
-- names in Settings. A favourite is a badminfo player (player_id), or only a
-- name, for players not in any imported badminfo tournament; lib/favourites.js
-- ties a name-only one to its player once exactly one player has that name.
-- The old names and the badminfo links pasted for them move over.

CREATE TABLE favourites (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  player_id TEXT UNIQUE,              -- badminfo id; NULL when known only by name
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO favourites (name, player_id)
  SELECT p.value, (SELECT l.value FROM settings s2, json_each(s2.value) l WHERE s2.key = 'playerLinks' AND l.key = p.value)
  FROM settings s, json_each(s.value) p
  WHERE s.key = 'players' AND p.type = 'text'
  GROUP BY p.value ORDER BY MIN(p.key);

DELETE FROM settings WHERE key IN ('players', 'playerLinks');
