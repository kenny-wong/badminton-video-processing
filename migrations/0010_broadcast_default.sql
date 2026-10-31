-- The broadcast look became the default scoreboard (1.17.0). A board still on
-- the old default (TV green, untouched) moves to it, at the new default size;
-- any look chosen or changed by hand is kept.

UPDATE settings SET value = json_set(value,
    '$.preset', 'broadcast', '$.box', '#f5f5f3', '$.text', '#16181d', '$.accent', '#b9622e', '$.pointsText', '#ffffff',
    '$.font', 'Bahnschrift', '$.opacity', 97, '$.layout', 'broadcast',
    '$.scale', CASE WHEN json_extract(value, '$.scale') = 100 THEN 80 ELSE json_extract(value, '$.scale') END)
  WHERE key = 'board' AND json_extract(value, '$.preset') = 'tv' AND json_extract(value, '$.box') = '#0f3b2d'
    AND json_extract(value, '$.text') = '#ffffff' AND json_extract(value, '$.accent') = '#f0b429'
    AND json_extract(value, '$.pointsText') = '#0f3b2d' AND json_extract(value, '$.font') = 'Arial' AND json_extract(value, '$.opacity') = 85;
