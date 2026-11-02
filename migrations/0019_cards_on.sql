-- Title and end cards are on by default (the user's choice, 1.51.0): saved settings that had them off are
-- turned on once; they can still be switched off in Settings or for one render.

UPDATE settings SET value = json_set(value, '$.title', json('true'), '$.end', json('true')) WHERE key = 'cards';
