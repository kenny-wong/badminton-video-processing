-- Tagging taken off a match when its last video was unlinked, kept with the
-- video (JSON of the matches tagging columns) until it is linked again.

ALTER TABLE videos ADD COLUMN carried_tagging TEXT;
