/*
# Create hotel channel operations decision training tables

This migration creates the schema for a hotel channel operations decision training tool
used in university hotel management courses. Groups of students fill in channel
distribution and pricing decisions across four operating periods; teachers view all
submissions and export to Excel.

1. New Tables
- `groups` — student groups that log in to submit decisions
  - id (uuid, PK)
  - name (text, unique, not null) — group name chosen at setup
  - password_hash (text, not null) — simple password hash for group login
  - hotel_name (text, not null) — hotel name the group is operating
  - created_at (timestamptz)
- `decisions` — one submitted decision record per group
  - id (uuid, PK)
  - group_id (uuid, FK -> groups.id ON DELETE CASCADE)
  - group_name (text, not null) — denormalized for easy export
  - hotel_name (text, not null) — denormalized for easy export
  - payload (jsonb, not null) — full decision data (periods, channels, special factors, calculations)
  - status (text, not null default 'draft') — 'draft' or 'submitted'
  - submitted_at (timestamptz, nullable)
  - created_at (timestamptz)
  - updated_at (timestamptz)

2. Security
- Enable RLS on both tables.
- `groups`: anon + authenticated can read (needed for login lookup) and insert/update
  (classroom tool, no sensitive personal data). Update restricted to matching password.
- `decisions`: anon + authenticated can read and write. The frontend enforces group
  isolation by matching group_id; the tool is a classroom training app with no
  sensitive personal data. This is intentionally a shared, single-tenant classroom
  dataset per the bolt-database single-tenant pattern (no auth.users linkage).

3. Important Notes
- This is a single-tenant classroom tool with no Supabase Auth sign-in screen.
  Groups authenticate via a group-name + password lookup against the `groups` table,
  not via Supabase Auth. Policies therefore use `TO anon, authenticated`.
- The teacher role is gated in the frontend by a teacher password stored in the
  payload/env; it has no DB-level row restriction beyond the shared access above.
- `payload` stores the full structured decision (periods -> channels -> pricing &
  quotas, special factors, computed results) as JSONB for flexibility and easy export.
*/