ALTER TABLE groups ADD COLUMN IF NOT EXISTS password_plain TEXT NOT NULL DEFAULT '000000';
UPDATE groups SET password_plain = '000000' WHERE password_plain = '000000';