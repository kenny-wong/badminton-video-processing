-- The players of each match sent to the planner, as badminfo has them:
-- [[{"id", "name"}], [{"id", "name"}]], the match's first side first. NULL = to be looked up.
ALTER TABLE planner_links ADD COLUMN sides TEXT;
