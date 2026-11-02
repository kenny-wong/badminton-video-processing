-- The broadcast looks' lettering is now D-DIN Condensed (public/fonts, SIL Open Font License), the
-- free DIN 1451 condensed that matches the broadcast's own. A saved look still on the old default,
-- Bahnschrift, with a broadcast layout moves to it once; any other font chosen stays.

UPDATE settings SET value = json_set(value, '$.font', 'D-DIN Condensed')
  WHERE key = 'board' AND json_valid(value)
    AND json_extract(value, '$.font') = 'Bahnschrift'
    AND json_extract(value, '$.layout') IN ('international', 'broadcast');
