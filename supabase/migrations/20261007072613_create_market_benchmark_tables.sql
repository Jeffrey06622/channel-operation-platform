/*
# Create market benchmark tables

Creates three read-only reference tables for hotel industry benchmark data,
imported from CSV seed files. These tables power the "市场环境数据" (market
environment) tab on the teacher dashboard and the "市场参考" (market reference)
panel on the student dashboard.

## 1. New Tables

### market_benchmarks (行业经营基准)
- `id` (uuid, primary key)
- `section` (text) — classification section, e.g. '星级分类', '管理模式分类', '城市等级分类', '平均房价分类', '主要市场分类'
- `metric` (text) — metric name, e.g. '平均住宿率（%）', '平均房价（元/间）', '每间可供出租客房收入（元/间）', '经营毛利率（%）'
- `class` (text) — hotel class, e.g. '五星', '国际管理-五星', '一线城市-五星', '房价1000元以上', '北京-五星'
- `fiscal_year` (int) — fiscal year (2018–2025)
- `value` (numeric) — benchmark value (percentages stored as decimals, e.g. 0.639 = 63.9%)
- Unique constraint: (section, metric, class, fiscal_year)

### channel_benchmarks (订房渠道占比)
- `id` (uuid, primary key)
- `section` (text) — classification section
- `channel` (text) — booking channel name, e.g. 'OTA直连', '酒店协议客户', '酒店社交媒体'
- `hotel_class` (text) — hotel class
- `fiscal_year` (int)
- `share` (numeric) — share as decimal (e.g. 0.294 = 29.4%)
- Unique constraint: (section, channel, hotel_class, fiscal_year)

### guest_segment_benchmarks (客源结构)
- `id` (uuid, primary key)
- `section` (text) — classification section
- `guest_type` (text) — guest segment type, e.g. '散客-商务散客', '团队-酒店店内会议'
- `hotel_class` (text) — hotel class
- `fiscal_year` (int)
- `share` (numeric) — share as decimal
- Unique constraint: (section, guest_type, hotel_class, fiscal_year)

## 2. Security
- RLS enabled on all three tables.
- SELECT only for anon + authenticated (read-only reference data, no user-scoped ownership).
- No INSERT/UPDATE/DELETE policies — data is managed via migrations only.

## 3. Notes
- Data is imported separately via INSERT statements after table creation.
- The app uses custom auth (group passwords in `groups` table), so the frontend
  runs as the `anon` role. SELECT policies must include `anon`.
*/

CREATE TABLE IF NOT EXISTS market_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  metric text NOT NULL,
  class text NOT NULL,
  fiscal_year int NOT NULL,
  value numeric NOT NULL,
  UNIQUE (section, metric, class, fiscal_year)
);

ALTER TABLE market_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_market_benchmarks" ON market_benchmarks;
CREATE POLICY "anon_select_market_benchmarks"
  ON market_benchmarks FOR SELECT
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS channel_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  channel text NOT NULL,
  hotel_class text NOT NULL,
  fiscal_year int NOT NULL,
  share numeric NOT NULL,
  UNIQUE (section, channel, hotel_class, fiscal_year)
);

ALTER TABLE channel_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_channel_benchmarks" ON channel_benchmarks;
CREATE POLICY "anon_select_channel_benchmarks"
  ON channel_benchmarks FOR SELECT
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS guest_segment_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  guest_type text NOT NULL,
  hotel_class text NOT NULL,
  fiscal_year int NOT NULL,
  share numeric NOT NULL,
  UNIQUE (section, guest_type, hotel_class, fiscal_year)
);

ALTER TABLE guest_segment_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_guest_segment_benchmarks" ON guest_segment_benchmarks;
CREATE POLICY "anon_select_guest_segment_benchmarks"
  ON guest_segment_benchmarks FOR SELECT
  TO anon, authenticated USING (true);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_market_benchmarks_class_year ON market_benchmarks (class, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_channel_benchmarks_class_year ON channel_benchmarks (hotel_class, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_guest_segment_benchmarks_class_year ON guest_segment_benchmarks (hotel_class, fiscal_year);
