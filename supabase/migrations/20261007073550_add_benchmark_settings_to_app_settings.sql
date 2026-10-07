/*
# Add benchmark settings columns to app_settings

1. Modified Tables
- `app_settings`: add `benchmark_fiscal_year` (int, default 2025) and `benchmark_hotel_class` (text, default '五星')
  These store the teacher's selected benchmark year and hotel class for market environment data display.
2. Security
- No RLS changes — app_settings already has existing policies.
3. Notes
- Idempotent: uses DO $$ ... IF NOT EXISTS ... END $$ to avoid errors on re-run.
- Default fiscal year is 2025, default hotel class is '五星'.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_settings' AND column_name = 'benchmark_fiscal_year') THEN
    ALTER TABLE app_settings ADD COLUMN benchmark_fiscal_year int NOT NULL DEFAULT 2025;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_settings' AND column_name = 'benchmark_hotel_class') THEN
    ALTER TABLE app_settings ADD COLUMN benchmark_hotel_class text NOT NULL DEFAULT '五星';
  END IF;
END $$;