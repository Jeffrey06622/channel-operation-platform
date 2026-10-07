/*
# Add class_label to groups

## Summary
Adds a `class_label` column to the `groups` table so each student group can
be tagged with the class they belong to (e.g. "2023级酒店管理1班").

## Changes
- `groups`: new nullable text column `class_label` (empty string default)

## Notes
- Column is nullable/defaulted so existing rows are not broken.
- No RLS changes needed — existing policies already cover the column.
*/

ALTER TABLE groups ADD COLUMN IF NOT EXISTS class_label text NOT NULL DEFAULT '';
