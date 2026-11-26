-- When a video's rallies were tagged automatically (by the tagging helper), not by hand: an ISO time.
-- NULL = tagged by hand, or reviewed since. Follows the video like the rest of its tagging.
ALTER TABLE matches ADD COLUMN auto_tagged TEXT;
