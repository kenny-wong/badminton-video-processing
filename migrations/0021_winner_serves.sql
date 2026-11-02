-- In a game's own video (game 2 or 3) the winner of the game before serves
-- first, as the Laws say, not B in game 2 and A in game 3. Only untagged game
-- rows change, so a server chosen while tagging is kept. Without that game's
-- result they keep what they have.

UPDATE matches SET first_server = CASE
    WHEN json_extract(games, '$[' || (game - 2) || '][0]') > json_extract(games, '$[' || (game - 2) || '][1]') THEN 'a'
    ELSE 'b' END
  WHERE game >= 2 AND rallies = '[]' AND json_valid(games)
    AND json_extract(games, '$[' || (game - 2) || '][0]') IS NOT NULL
    AND json_extract(games, '$[' || (game - 2) || '][0]') <> json_extract(games, '$[' || (game - 2) || '][1]');
