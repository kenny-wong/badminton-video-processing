-- The Players list's own order (dragged on the Players page): 0, 1, 2, ...
-- Players never moved have NULL and come after, by name.

ALTER TABLE favourites ADD COLUMN position INTEGER;
