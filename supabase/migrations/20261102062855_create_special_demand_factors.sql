/*
# Create special_demand_factors (teacher-entered special demand factors)

1. New table
- `special_demand_factors` stores special market demand factors that the teacher records per teaching week (holidays, events, weather, competition, policy).
- Each factor has a name, category, direction, impact magnitude (%), demand multiplier (1 + magnitude/100), scope (all / room types / channels), expected student response, trigger threshold (%), effective date range, an active switch, a student-selectable switch and a sort order.

2. Security
- Row level security is enabled.
- The app has no sign-in screen, so the anon and authenticated roles get SELECT, INSERT, UPDATE and DELETE, matching the other app tables.
- Policies are scoped to anon and authenticated with USING (true) because the table is intentionally shared within the class app.

3. Notes
- Existing decisions and submitted weeks are not modified.
- Indexes on week_key and is_active support the weekly lookup and the active-factor filter.
*/

CREATE TABLE IF NOT EXISTS special_demand_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_key text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'event',
  direction text NOT NULL DEFAULT 'increase',
  magnitude numeric NOT NULL DEFAULT 0,
  demand_multiplier numeric NOT NULL DEFAULT 1,
  description text NOT NULL DEFAULT '',
  scope_type text NOT NULL DEFAULT 'all',
  scope_keys text[] NOT NULL DEFAULT '{}',
  expected_response text NOT NULL DEFAULT 'raise_price',
  threshold numeric NOT NULL DEFAULT 5,
  effective_from date,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  student_selectable boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE special_demand_factors IS
  '教师录入的特殊需求因素。week_key 关联市场周期 wk1/wk2...；category 取 event|holiday|weather|competition|policy|other；direction 取 increase|decrease|neutral；magnitude 为影响强度%（正数为需求上升）；demand_multiplier = 1 + magnitude/100；scope_type 取 all|room_type|channel，scope_keys 存房型或渠道 key；expected_response 取 raise_price|expand_quota|shift_mix|hold_price|no_change；threshold 为触发阈值%；effective_from/to 留空则取该周起止日；is_active 为启停；student_selectable 决定学生端是否可勾选并计入计算。';

CREATE INDEX IF NOT EXISTS idx_sdf_week ON special_demand_factors (week_key);
CREATE INDEX IF NOT EXISTS idx_sdf_active ON special_demand_factors (is_active);

ALTER TABLE special_demand_factors ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON special_demand_factors TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_sdf" ON special_demand_factors;
CREATE POLICY "anon_select_sdf" ON special_demand_factors FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_sdf" ON special_demand_factors;
CREATE POLICY "anon_insert_sdf" ON special_demand_factors FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_sdf" ON special_demand_factors;
CREATE POLICY "anon_update_sdf" ON special_demand_factors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_sdf" ON special_demand_factors;
CREATE POLICY "anon_delete_sdf" ON special_demand_factors FOR DELETE TO anon, authenticated USING (true);
