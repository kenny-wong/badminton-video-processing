-- Cutting keeps 1.5 seconds before and after each rally by default (was 2 before, 2.5 after); the user
-- asked for it, so the saved values move to 1.5 once as well. Settings can change them again.

UPDATE settings SET value = '1.5' WHERE key IN ('pre', 'post');
