/*
# Require a valid room-count (quota) on every submitted week

## Why
Production incident: 酒管25091 第6组 submitted wk5 with all 18 prices filled
and all 18 quotas null. The page then rendered "总房量配额 0/100", which reads
as "my submitted work went blank". Root cause: the deployed validation only
enforced prices; a quota was never required, and `week_decision_has_content`
(counts as soon as one price or quota exists) could not catch it either.

`submit_week` is now gated on a per-cell quota rule, exactly where the price
rules already run — before `save_week`, so a rejected submission writes nothing.

## Rule (mirrors `quotaSubmissionError` in src/calc.ts)
For every currently configured channel x room type:
  1. the cell must exist and carry a `quota`;
  2. quota must be an integer >= 1 (0 and negatives are rejected);
  3. quota must be <= that room type's inventory;
  4. per room type, the quotas summed over all channels must be <= inventory.

The configured set is derived from `app_settings.base_params` when present and
otherwise from the built-in defaults (6 channels, superior 50 / deluxe 40 /
suite 10), matching `resolveChannels` / `resolveRoomTypes` in src/domain.ts.

Stale channel keys left over from a configuration the teacher has since removed
are ignored, so a group can never be blocked by a cell the UI cannot render.

## Errors
SQLSTATE 40013, message prefix `QUOTA_INVALID:`.
40012 (WEEK_INCOMPLETE) is kept for a week with no content at all.

## Data safety
No existing row is read-modified or deleted. The gate runs *before* `save_week`
and before the `week_submissions` insert; a rejection rolls the whole call back,
so no draft update and no submission record are produced. `save_week` keeps
accepting partial drafts so debounced auto-save keeps working mid-edit.
*/

-- ─── 1. Empty-week predicate (kept so this migration also stands alone) ──────
CREATE OR REPLACE FUNCTION public.week_decision_has_content(p_week_data jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_channels jsonb;
  v_ch       jsonb;
  v_cell     jsonb;
BEGIN
  IF p_week_data IS NULL OR jsonb_typeof(p_week_data) <> 'object' THEN
    RETURN false;
  END IF;

  v_channels := p_week_data -> 'channels';
  IF v_channels IS NULL OR jsonb_typeof(v_channels) <> 'object' THEN
    RETURN false;
  END IF;

  FOR v_ch IN SELECT value FROM jsonb_each(v_channels)
  LOOP
    CONTINUE WHEN v_ch IS NULL
      OR jsonb_typeof(v_ch) <> 'object'
      OR (v_ch -> 'roomTypes') IS NULL
      OR jsonb_typeof(v_ch -> 'roomTypes') <> 'object';

    FOR v_cell IN SELECT value FROM jsonb_each(v_ch -> 'roomTypes')
    LOOP
      CONTINUE WHEN v_cell IS NULL OR jsonb_typeof(v_cell) <> 'object';

      IF (v_cell -> 'quota') IS NOT NULL AND (v_cell -> 'quota') <> 'null'::jsonb THEN
        RETURN true;
      END IF;
      IF (v_cell -> 'weekday_quota') IS NOT NULL AND (v_cell -> 'weekday_quota') <> 'null'::jsonb THEN
        RETURN true;
      END IF;
      IF (v_cell -> 'weekend_quota') IS NOT NULL AND (v_cell -> 'weekend_quota') <> 'null'::jsonb THEN
        RETURN true;
      END IF;
      IF (v_cell -> 'price') IS NOT NULL AND (v_cell -> 'price') <> 'null'::jsonb THEN
        RETURN true;
      END IF;
      IF (v_cell -> 'weekday_price') IS NOT NULL AND (v_cell -> 'weekday_price') <> 'null'::jsonb THEN
        RETURN true;
      END IF;
      IF (v_cell -> 'weekend_price') IS NOT NULL AND (v_cell -> 'weekend_price') <> 'null'::jsonb THEN
        RETURN true;
      END IF;
    END LOOP;
  END LOOP;

  RETURN false;
END;
$$;

-- ─── 2. Quota gate: returns NULL when the week is submittable ───────────────
CREATE OR REPLACE FUNCTION public.week_quota_problem(p_week_data jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_bp          jsonb;
  v_channels    text[] := ARRAY['ctrip','meituan','corporate','direct','douyin','xhs'];
  v_custom_ch   jsonb;
  v_room_types  text[] := ARRAY['superior','deluxe','suite'];
  v_inventory   numeric[] := ARRAY[50,40,10];
  v_names       text[] := ARRAY['高级房','豪华房','套房'];
  v_custom_rt   jsonb;
  v_ch_key      text;
  v_ch_name     text;
  v_i           int;
  v_j           int;
  v_rt_key      text;
  v_rt_name     text;
  v_inv         numeric;
  v_ov          jsonb;
  v_cell        jsonb;
  v_cell_ch     jsonb;
  v_quota       numeric;
  v_label       text;
  v_sum         numeric;
  v_ch_names    text[] := ARRAY['携程','美团','协议客','直销','抖音','小红书'];
BEGIN
  IF p_week_data IS NULL OR jsonb_typeof(p_week_data) <> 'object' THEN
    RETURN '本周决策数据为空';
  END IF;

  -- Resolve the channel / room-type set currently configured by the teacher.
  SELECT base_params INTO v_bp FROM public.app_settings ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  IF v_bp IS NOT NULL AND jsonb_typeof(v_bp) = 'object' THEN
    -- Custom channels keep the built-in six and append the teacher's own.
    v_custom_ch := v_bp -> 'customChannels';
    IF jsonb_typeof(v_custom_ch) = 'array' THEN
      FOR v_ov IN SELECT value FROM jsonb_array_elements(v_custom_ch) LOOP
        IF (v_ov ->> 'key') IS NOT NULL THEN
          v_channels := array_append(v_channels, v_ov ->> 'key');
          v_ch_names := array_append(v_ch_names, coalesce(v_ov ->> 'name', v_ov ->> 'key'));
        END IF;
      END LOOP;
    END IF;

    -- Per-room-type overrides (inventory) plus custom room types.
    FOR v_i IN 1 .. array_length(v_room_types, 1) LOOP
      v_ov := v_bp -> 'roomTypes' -> v_room_types[v_i];
      IF jsonb_typeof(v_ov) = 'object' AND (v_ov ->> 'inventory') IS NOT NULL
         AND (v_ov ->> 'inventory') ~ '^[0-9]+(\.[0-9]+)?$' THEN
        v_inventory[v_i] := (v_ov ->> 'inventory')::numeric;
        IF (v_ov ->> 'name') IS NOT NULL THEN
          v_names[v_i] := v_ov ->> 'name';
        END IF;
      END IF;
    END LOOP;

    v_custom_rt := v_bp -> 'customRoomTypes';
    IF jsonb_typeof(v_custom_rt) = 'array' THEN
      FOR v_ov IN SELECT value FROM jsonb_array_elements(v_custom_rt) LOOP
        IF (v_ov ->> 'key') IS NOT NULL THEN
          v_room_types := array_append(v_room_types, v_ov ->> 'key');
          v_inventory  := array_append(v_inventory,
            CASE WHEN (v_ov ->> 'inventory') ~ '^[0-9]+(\.[0-9]+)?$'
                 THEN (v_ov ->> 'inventory')::numeric
                 ELSE 0 END);
          v_names := array_append(v_names, coalesce(v_ov ->> 'name', v_ov ->> 'key'));
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Per-cell rules: present, integer, >= 1, <= inventory.
  FOR v_i IN 1 .. coalesce(array_length(v_channels, 1), 0) LOOP
    v_ch_key  := v_channels[v_i];
    v_ch_name := coalesce(v_ch_names[v_i], v_ch_key);
    v_cell_ch := p_week_data -> 'channels' -> v_ch_key;

    FOR v_j IN 1 .. coalesce(array_length(v_room_types, 1), 0) LOOP
      v_rt_key := v_room_types[v_j];
      v_rt_name := coalesce(v_names[v_j], v_rt_key);
      v_inv := v_inventory[v_j];

      IF v_cell_ch IS NULL OR jsonb_typeof(v_cell_ch) <> 'object'
         OR jsonb_typeof(v_cell_ch -> 'roomTypes') <> 'object' THEN
        RETURN format('%s-%s：尚未填写配额', v_ch_name, v_rt_name);
      END IF;

      v_cell := v_cell_ch -> 'roomTypes' -> v_rt_key;
      IF v_cell IS NULL OR jsonb_typeof(v_cell) <> 'object' THEN
        RETURN format('%s-%s：尚未填写配额', v_ch_name, v_rt_name);
      END IF;

      -- 周末价模式下工作日/周末配额分别校验（缺省回退到旧版单一 quota，
      -- 与前端 splitQuotas 的回显逻辑一致）；普通模式只校验 quota。
      IF (v_cell -> 'weekend_pricing_enabled') = 'true'::jsonb THEN
        -- ── 工作日配额 ──
        IF (v_cell -> 'weekday_quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'weekday_quota') = 'number' THEN
          v_quota := (v_cell ->> 'weekday_quota')::numeric;
          v_label := '工作日配额';
        ELSIF (v_cell -> 'quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'quota') = 'number' THEN
          v_quota := (v_cell ->> 'quota')::numeric;
          v_label := '工作日配额(沿用原配额)';
        ELSE
          RETURN format('%s-%s：工作日配额未填写', v_ch_name, v_rt_name);
        END IF;
        IF v_quota <> trunc(v_quota) THEN
          RETURN format('%s-%s：%s需为整数（当前 %s）', v_ch_name, v_rt_name, v_label, v_quota);
        END IF;
        IF v_quota <= 0 THEN
          RETURN format('%s-%s：%s不能为 0 或负数（当前 %s）', v_ch_name, v_rt_name, v_label, v_quota);
        END IF;
        IF v_quota > v_inv THEN
          RETURN format('%s-%s：%s %s 间超过该房型房量 %s 间', v_ch_name, v_rt_name, v_label, v_quota, v_inv);
        END IF;

        -- ── 周末配额 ──
        IF (v_cell -> 'weekend_quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'weekend_quota') = 'number' THEN
          v_quota := (v_cell ->> 'weekend_quota')::numeric;
          v_label := '周末配额';
        ELSIF (v_cell -> 'quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'quota') = 'number' THEN
          v_quota := (v_cell ->> 'quota')::numeric;
          v_label := '周末配额(沿用原配额)';
        ELSE
          RETURN format('%s-%s：周末配额未填写', v_ch_name, v_rt_name);
        END IF;
        IF v_quota <> trunc(v_quota) THEN
          RETURN format('%s-%s：%s需为整数（当前 %s）', v_ch_name, v_rt_name, v_label, v_quota);
        END IF;
        IF v_quota <= 0 THEN
          RETURN format('%s-%s：%s不能为 0 或负数（当前 %s）', v_ch_name, v_rt_name, v_label, v_quota);
        END IF;
        IF v_quota > v_inv THEN
          RETURN format('%s-%s：%s %s 间超过该房型房量 %s 间', v_ch_name, v_rt_name, v_label, v_quota, v_inv);
        END IF;
      ELSE
        IF (v_cell -> 'quota') IS NULL OR jsonb_typeof(v_cell -> 'quota') <> 'number' THEN
          RETURN format('%s-%s：配额未填写', v_ch_name, v_rt_name);
        END IF;

        v_quota := (v_cell ->> 'quota')::numeric;

        IF v_quota <> trunc(v_quota) THEN
          RETURN format('%s-%s：配额需为整数（当前 %s）', v_ch_name, v_rt_name, v_quota);
        END IF;

        IF v_quota <= 0 THEN
          RETURN format('%s-%s：配额不能为 0 或负数（当前 %s）', v_ch_name, v_rt_name, v_quota);
        END IF;

        IF v_quota > v_inv THEN
          RETURN format('%s-%s：配额 %s 间超过该房型房量 %s 间', v_ch_name, v_rt_name, v_quota, v_inv);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Aggregate rule: per room type, quotas summed over all channels <= inventory.
  -- 周末价模式下工作日与周末分别汇总校验（缺省回退到旧版 quota）。
  FOR v_j IN 1 .. coalesce(array_length(v_room_types, 1), 0) LOOP
    v_rt_key := v_room_types[v_j];
    v_rt_name := coalesce(v_names[v_j], v_rt_key);
    v_inv := v_inventory[v_j];
    v_sum := 0;
    FOR v_i IN 1 .. coalesce(array_length(v_channels, 1), 0) LOOP
      v_cell := p_week_data -> 'channels' -> v_channels[v_i] -> 'roomTypes' -> v_rt_key;
      IF v_cell IS NOT NULL AND jsonb_typeof(v_cell) = 'object' THEN
        IF (v_cell -> 'weekend_pricing_enabled') = 'true'::jsonb THEN
          IF (v_cell -> 'weekday_quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'weekday_quota') = 'number' THEN
            v_sum := v_sum + (v_cell ->> 'weekday_quota')::numeric;
          ELSIF (v_cell -> 'quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'quota') = 'number' THEN
            v_sum := v_sum + (v_cell ->> 'quota')::numeric;
          END IF;
        ELSIF (v_cell -> 'quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'quota') = 'number' THEN
          v_sum := v_sum + (v_cell ->> 'quota')::numeric;
        END IF;
      END IF;
    END LOOP;
    IF v_sum > v_inv THEN
      RETURN format('%s：各渠道工作日配额之和 %s 间超过该房型房量 %s 间', v_rt_name, v_sum, v_inv);
    END IF;

    v_sum := 0;
    FOR v_i IN 1 .. coalesce(array_length(v_channels, 1), 0) LOOP
      v_cell := p_week_data -> 'channels' -> v_channels[v_i] -> 'roomTypes' -> v_rt_key;
      IF v_cell IS NOT NULL AND jsonb_typeof(v_cell) = 'object' THEN
        IF (v_cell -> 'weekend_pricing_enabled') = 'true'::jsonb THEN
          IF (v_cell -> 'weekend_quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'weekend_quota') = 'number' THEN
            v_sum := v_sum + (v_cell ->> 'weekend_quota')::numeric;
          ELSIF (v_cell -> 'quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'quota') = 'number' THEN
            v_sum := v_sum + (v_cell ->> 'quota')::numeric;
          END IF;
        ELSIF (v_cell -> 'quota') IS NOT NULL AND jsonb_typeof(v_cell -> 'quota') = 'number' THEN
          v_sum := v_sum + (v_cell ->> 'quota')::numeric;
        END IF;
      END IF;
    END LOOP;
    IF v_sum > v_inv THEN
      RETURN format('%s：各渠道周末配额之和 %s 间超过该房型房量 %s 间', v_rt_name, v_sum, v_inv);
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- ─── 3. submit_week: gate before any write ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_week(
  p_group_id uuid,
  p_week_key text,
  p_week_data jsonb,
  p_hotel_name text DEFAULT NULL,
  p_group_name text DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_submission_status text DEFAULT 'on_time'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_saved jsonb;
  v_decision_id uuid;
  v_updated_at timestamptz;
  v_problem text;
BEGIN
  IF p_submission_status NOT IN ('on_time', 'late') THEN
    RAISE EXCEPTION 'Invalid submission status';
  END IF;

  -- 40012: a week with no pricing/quota content at all.
  IF NOT public.week_decision_has_content(p_week_data) THEN
    RAISE EXCEPTION 'WEEK_INCOMPLETE: week % carries no pricing/quota content; an empty week cannot be submitted', p_week_key
      USING ERRCODE = '40012';
  END IF;

  -- 40013: every configured channel x room type needs a quota of 1..inventory.
  -- Runs before save_week, so a rejected submission persists nothing.
  v_problem := public.week_quota_problem(p_week_data);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'QUOTA_INVALID: %', v_problem
      USING ERRCODE = '40013';
  END IF;

  v_saved := public.save_week(
    p_group_id,
    p_week_key,
    p_week_data,
    p_hotel_name,
    p_group_name,
    p_expected_updated_at
  );

  v_decision_id := (v_saved->>'decision_id')::uuid;
  v_updated_at := (v_saved->>'updated_at')::timestamptz;

  INSERT INTO public.week_submissions (group_id, week_key, submission_status)
    VALUES (p_group_id, p_week_key, p_submission_status);

  RETURN jsonb_build_object(
    'ok', true,
    'decision_id', v_decision_id,
    'updated_at', to_jsonb(v_updated_at),
    'submission_status', p_submission_status
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'SUBMITTED_WEEK_LOCKED: this week has already been submitted'
      USING ERRCODE = '40011';
END;
$$;

-- ─── 4. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.week_decision_has_content(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.week_decision_has_content(jsonb) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.week_quota_problem(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.week_quota_problem(jsonb) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_week(uuid, text, jsonb, text, text, timestamptz, text) TO anon, authenticated;
