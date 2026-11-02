-- Each player's nation, for the scoreboard's flags (country codes as in public/shared/flags.js).
-- players.nation: from badminfo, by the federation the player is registered with; England when
-- badminfo says nothing, so every badminfo player starts as England (profiles refine it when read).
-- favourites.nation: the user's choice on the Players page ('' = no flag); NULL follows badminfo,
-- so a player added by name only has no flag until one is chosen.

ALTER TABLE players ADD COLUMN nation TEXT;
ALTER TABLE favourites ADD COLUMN nation TEXT;
UPDATE players SET nation = 'ENG';
