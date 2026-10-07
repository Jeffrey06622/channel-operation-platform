/*
# Add Weekly Submission Control

## Summary
This migration adds two tables to support per-week submission locking.
Teachers can set which simulation week is currently active, and student
groups can submit their decisions once per week. After submitting a week,
that week's data is locked and cannot be modified.

## New Tables

### `app_settings`
A single-row table holding global settings for the platform.
- `id` (uuid, primary key)
- `current_week_key` (text) — the simulation week key currently open for submission (e.g. 'wk1')
- `updated_at` (timestamptz) — when the setting was last changed

### `week_submissions`
Tracks which groups have submitted each simulation week.
- `id` (uuid, primary key)
- `group_id` (uuid, FK → groups.id) — the submitting group
- `week_key` (text) — simulation week key (e.g. 'wk1')
- `submitted_at` (timestamptz) — when the group submitted this week
- Unique constraint on (group_id, week_key) — one submission per group per week

## Security
- RLS enabled on both tables.
- Both tables use `TO anon, authenticated` policies — the app uses anon-key
  auth (group login via password hash), not Supabase Auth.
- `app_settings`: anon can SELECT; only anon can INSERT/UPDATE (teacher writes via same key).
- `week_submissions`: anon can SELECT, INSERT; no UPDATE/DELETE allowed (submissions are final).

## Important Notes
1. The `app_settings` table is initialised with one row: `current_week_key = 'wk1'`.
2. The unique constraint on `week_submissions(group_id, week_key)` enforces the
   "once per week per group" rule at the database level — duplicate inserts fail.
3. Existing `decisions` rows are unaffected; the payload remains the source of
   truth for all week data, and `week_submissions` tracks submission state only.
*/

-- ─── app_settings ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  current_week_key text NOT NULL DEFAULT 'wk1',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_app_settings" ON app_settings;
CREATE POLICY "anon_select_app_settings" ON app_settings
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_app_settings" ON app_settings;
CREATE POLICY "anon_insert_app_settings" ON app_settings
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_app_settings" ON app_settings;
CREATE POLICY "anon_update_app_settings" ON app_settings
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_app_settings" ON app_settings;
CREATE POLICY "anon_delete_app_settings" ON app_settings
  FOR DELETE TO anon, authenticated USING (true);

-- Seed the single settings row if it doesn't exist yet
INSERT INTO app_settings (current_week_key)
SELECT 'wk1'
WHERE NOT EXISTS (SELECT 1 FROM app_settings);


-- ─── week_submissions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS week_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  week_key     text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, week_key)
);

CREATE INDEX IF NOT EXISTS idx_week_submissions_group ON week_submissions(group_id);
CREATE INDEX IF NOT EXISTS idx_week_submissions_week  ON week_submissions(week_key);

ALTER TABLE week_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_week_submissions" ON week_submissions;
CREATE POLICY "anon_select_week_submissions" ON week_submissions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_week_submissions" ON week_submissions;
CREATE POLICY "anon_insert_week_submissions" ON week_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true);
