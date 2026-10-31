-- The YouTube link once a finished video is uploaded by hand, where the match
-- starts and ends in its video, and the score when the video starts mid-match.

ALTER TABLE matches ADD COLUMN youtube_url TEXT;
ALTER TABLE matches ADD COLUMN uploaded_at TEXT;
ALTER TABLE matches ADD COLUMN match_start REAL;  -- seconds into the match video
ALTER TABLE matches ADD COLUMN match_end REAL;
ALTER TABLE matches ADD COLUMN start_score TEXT;  -- JSON { games: [[a, b], ...], points: [a, b] }, NULL = 0-0
