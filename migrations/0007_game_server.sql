-- B serves first by default in game 2's own video (A in games 1 and 3). Only
-- untagged game-2 rows change, so a server chosen while tagging is kept.

UPDATE matches SET first_server = 'b' WHERE game = 2 AND rallies = '[]';
