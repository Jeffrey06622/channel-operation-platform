/*
# Add unique constraint on decisions.group_id and deduplicate

The decisions table had no unique constraint on group_id, allowing multiple
rows per group. This caused "JSON object requested, multiple (or no) rows
returned" errors when .single() was used after insert.

1. Deduplicate: keep only the latest (max updated_at) row per group_id
2. Add unique constraint on group_id
3. This prevents future duplicate inserts
*/

-- Deduplicate: delete all but the latest row per group_id
DELETE FROM decisions
WHERE id NOT IN (
  SELECT DISTINCT ON (group_id) id
  FROM decisions
  ORDER BY group_id, updated_at DESC, created_at DESC
);

-- Add unique constraint
ALTER TABLE decisions ADD CONSTRAINT decisions_group_id_unique UNIQUE (group_id);
