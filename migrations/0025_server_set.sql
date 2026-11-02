-- Who serves first is no longer assumed to be A: until it is chosen in the editor (or known from the
-- result: in game 2 or 3 the winner of the game before serves first), a video counts as not tagged.
-- server_set: 1 = chosen or known, NULL = still to choose. Videos already tagged keep their server as
-- chosen (the user's choice, 2026-11-02).

ALTER TABLE matches ADD COLUMN server_set INTEGER;

UPDATE matches SET server_set = 1 WHERE json_valid(rallies) AND json_array_length(rallies) > 0;

UPDATE matches SET server_set = 1
  WHERE game >= 2 AND json_valid(games)
    AND json_extract(games, '$[' || (game - 2) || '][0]') IS NOT NULL
    AND json_extract(games, '$[' || (game - 2) || '][0]') <> json_extract(games, '$[' || (game - 2) || '][1]');
