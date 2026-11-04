-- The corner view: an area of the picture shown enlarged in a corner of the video
-- (JSON { x, y, w, h, corner, size }, public/shared/inset.js). NULL = none. Follows the video with its tagging.

ALTER TABLE matches ADD COLUMN inset TEXT;
