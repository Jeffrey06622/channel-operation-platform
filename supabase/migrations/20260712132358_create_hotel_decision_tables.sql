/*
# Create hotel channel operations decision training tables

This migration creates the schema for a hotel channel operations decision training tool
used in university hotel management courses. Groups of students fill in channel
distribution and pricing decisions across four operating periods; teachers view all
submissions and export to Excel.

1. New Tables
- `groups` — student groups that log in to submit decisions
  - id (uuid, PK)
  - name (text, unique, not null) — group name
  - password_hash (text, not null) — simple hash for group login
  - hotel_name (text, not null) — hotel name the group operates
  - created_at (timestamptz)
- `decisions` — one submitted decision record per group
  - id (uuid, PK)
  - group_id (uuid, FK -> groups.id ON DELETE CASCADE)
  - group_name (text, not null) — denormalized for export
  - hotel_name (text, not null) — denormalized for export
  - payload (jsonb, not null) — full decision data
  - status (text, not null default 'draft') — 'draft' or 'submitted'
  - submitted_at (timestamptz, nullable)
  - created_at (timestamptz)
  - updated_at (timestamptz)

2. Security
- Enable RLS on both tables.
- Single-tenant classroom tool (no Supabase Auth sign-in screen). Groups log in via
  group-name + password lookup against `groups`. Policies use `TO anon, authenticated`.
- `groups`: anon + authenticated can read (login lookup) and insert/update.
- `decisions`: anon + authenticated can read and write; frontend enforces group isolation.

3. Important Notes
- No auth.users linkage — intentionally a shared classroom dataset.
- Teacher role gated in frontend by a teacher password.
*/

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  hotel_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_groups" ON groups;
CREATE POLICY "anon_select_groups" ON groups FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_groups" ON groups;
CREATE POLICY "anon_insert_groups" ON groups FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_groups" ON groups;
CREATE POLICY "anon_update_groups" ON groups FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_groups" ON groups;
CREATE POLICY "anon_delete_groups" ON groups FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  hotel_name text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_decisions" ON decisions;
CREATE POLICY "anon_select_decisions" ON decisions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_decisions" ON decisions;
CREATE POLICY "anon_insert_decisions" ON decisions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_decisions" ON decisions;
CREATE POLICY "anon_update_decisions" ON decisions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_decisions" ON decisions;
CREATE POLICY "anon_delete_decisions" ON decisions FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_decisions_group_id ON decisions(group_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);