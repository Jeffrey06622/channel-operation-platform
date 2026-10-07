/*
# Add multi-week open/close control and late submission support

## Summary
Upgrades the single-week open model to a multi-week batch open/close model.
Teachers can now open/close multiple weeks at once, and students can submit
or make up decisions for any week that is currently open. A global late-submit
deadline can be set; after it passes, all open-but-unsubmitted weeks lock.

## New Tables

### `open_weeks`
Tracks which simulation weeks are currently open (editable by students).
- `id` (uuid, PK)
- `week_key` (text, unique) — simulation week key (e.g. 'wk1')
- `opened_at` (timestamptz) — when the week was opened
- `created_at` (timestamptz)

## Modified Tables

### `app_settings`
- `late_submit_deadline` (timestamptz, nullable) — global deadline for late submissions.
  When set and passed, all open weeks that have no submission from a group are locked.

### `week_submissions`
- `submission_status` (text, nullable) — 'on_time' or 'late' or null.
  'on_time': submitted within the normal submission window (before the original
  single-week deadline or before late_submit_deadline if no per-week deadline).
  'late': submitted after the normal window but before late_submit_deadline.

## Security
- `open_weeks`: RLS enabled, anon+authenticated CRUD (shared classroom tool).
- `app_settings`: existing UPDATE policy covers the new column.
- `week_submissions`: existing UPDATE policy covers the new column.

## Important Notes
1. The `current_week_key` column in `app_settings` is kept for backward
   compatibility but is no longer the sole control — `open_weeks` is now the
   source of truth for which weeks are editable.
2. On migration, the current `current_week_key` value is seeded into
   `open_weeks` so the existing open week remains open.
3. `submission_status` defaults to NULL for existing rows; new inserts set it
   based on timing logic in the frontend.
*/
CREATE TABLE IF NOT EXISTS open_weeks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_key   text UNIQUE NOT NULL,
  opened_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE open_weeks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_open_weeks" ON open_weeks;
CREATE POLICY "anon_select_open_weeks" ON open_weeks
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_open_weeks" ON open_weeks;
CREATE POLICY "anon_insert_open_weeks" ON open_weeks
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_open_weeks" ON open_weeks;
CREATE POLICY "anon_delete_open_weeks" ON open_weeks
  FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_open_weeks" ON open_weeks;
CREATE POLICY "anon_update_open_weeks" ON open_weeks
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Add late_submit_deadline to app_settings
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS late_submit_deadline timestamptz;

-- Add submission_status to week_submissions
ALTER TABLE week_submissions
  ADD COLUMN IF NOT EXISTS submission_status text;

-- Seed open_weeks with the current_week_key from app_settings
INSERT INTO open_weeks (week_key)
SELECT current_week_key FROM app_settings
WHERE NOT EXISTS (
  SELECT 1 FROM open_weeks WHERE open_weeks.week_key = app_settings.current_week_key
);
