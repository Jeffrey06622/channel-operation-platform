/*
# Add submission_deadline and base_params to app_settings

1. Modified Tables
   - `app_settings`
     - `submission_deadline` (timestamptz, nullable) — when set and past, all group submissions are locked
     - `base_params` (jsonb, nullable) — teacher-defined overrides for total rooms, channel commission rates, room type inventories

2. Notes
   - NULL submission_deadline means no deadline (submissions always open unless week-locked)
   - NULL base_params means use built-in domain defaults
*/

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS submission_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS base_params jsonb;
