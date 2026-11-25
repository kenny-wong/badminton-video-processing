-- Each tournament's own video folder (lib/tournament-videos.js). The path is where it was last seen: on an external
-- drive its letter may change, and it is then found at the same place on another drive (lib/locate.js).
ALTER TABLE tournaments ADD COLUMN video_folder TEXT;
-- Whose matches its videos show: NULL = worked out, 'all' = every starred player's, else a favourites id.
ALTER TABLE tournaments ADD COLUMN video_player TEXT;
ALTER TABLE tournaments ADD COLUMN videos_scanned_at TEXT;
-- 1 for a video unlinked by hand: scanning doesn't link it by itself again.
ALTER TABLE videos ADD COLUMN no_auto INTEGER;
