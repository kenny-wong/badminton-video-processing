-- Setting originals aside is gone: the Tools page now offers to move them to
-- the Recycle Bin instead, so every video in the library takes part in matching.

ALTER TABLE videos DROP COLUMN set_aside;
