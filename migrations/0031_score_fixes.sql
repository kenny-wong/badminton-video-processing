-- A match's result corrected by hand: games and winner hold the correction, these hold what
-- Badminton England says. be_games NULL = not corrected. (A game's row follows its match.)
ALTER TABLE matches ADD COLUMN be_games TEXT;
ALTER TABLE matches ADD COLUMN be_winner INTEGER;
