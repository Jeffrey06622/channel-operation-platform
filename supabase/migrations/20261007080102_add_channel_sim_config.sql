/*
# Add channel_sim config column to app_settings

1. Changes
- Adds `channel_sim` jsonb column to `app_settings` table.
- Stores teacher-configurable channel transaction algorithm parameters:
  per-channel conversion rates, traffic caps, long-tail release schedules,
  cold-start discounts, content/ad costs, viral probabilities, and global
  price sensitivity.
- Defaults to NULL; the frontend falls back to built-in DEFAULT_CHANNEL_SIM
  when the column is null or missing.
2. Security
- No RLS policy changes. app_settings already has anon SELECT and
  authenticated UPDATE policies from prior migrations.
3. Notes
- No data loss: ADD COLUMN with nullable type is non-destructive.
- The column is JSONB so the config shape can evolve without migrations.
*/

ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS channel_sim jsonb DEFAULT NULL;
