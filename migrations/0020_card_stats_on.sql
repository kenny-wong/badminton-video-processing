-- The end card's line with the longest rally and the best run of points is on by default too (the user's
-- choice, 1.52.0): saved settings that had it off are turned on once.

UPDATE settings SET value = json_set(value, '$.stats', json('true')) WHERE key = 'cards';
