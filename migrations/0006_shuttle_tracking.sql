-- Shuttle tracking: the court's four corners as clicked on the video (JSON
-- [[x, y], ...] as fractions of the picture: near-left, near-right, far-right,
-- far-left), which team is at the near end when the video starts, and the
-- saved TrackNetV3 result.

ALTER TABLE matches ADD COLUMN court_corners TEXT;
ALTER TABLE matches ADD COLUMN near_at_start TEXT;  -- 'a' or 'b'
ALTER TABLE matches ADD COLUMN track_path TEXT;
ALTER TABLE matches ADD COLUMN tracked_at TEXT;
