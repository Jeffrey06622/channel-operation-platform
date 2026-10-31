/*
# Refuse to submit a week with no pricing/quota content

## Why
A weekly exercise IS the pricing/quota decision, so the teacher must be able to
tell whether a group did the work for a given week. Previously a group could
submit a completely blank week and still lock it in: `save_week` only rejected
overwriting existing data with empty data, and the front end only validated
ranges (it never required a value to be present).

Live evidence from production: of 234 channel × room-type cells across one
group's 13 saved weeks, 203 carried neither a price nor a quota.

## What changes
1. New predicate `week_decision_has_content(jsonb)` — true only when at least
   one channel × room type cell carries a quota or a price that is present and
   not JSON `null`.
2. `submit_week(...)` refuses the submission with SQLSTATE 40012
   (`WEEK_INCOMPLETE`) when that predicate is false. The check runs BEFORE
   `save_week`, so a rejected submission writes nothing — not even a draft.

## Deliberately unchanged
- `save_week` still accepts partial/blank drafts, so debounced auto-save keeps
  working while a group is mid-edit. Only *submitting* is gated.
- Weeks submitted before this migration are not re-validated; they stay as they
  are.

## Why the server check stops at "has content" instead of "all cells filled"
The authoritative "every channel × room type must be filled" rule is enforced
in the student screen (`validateWeek` in `src/calc.ts`), which knows the exact
channel/room-type set currently configured and can point at each missing cell.

The teacher can add and delete custom channels (BaseParamsPanel). A saved
payload keeps channel keys from earlier configurations, and the screen only
renders the channels that are configured *now* — so a stale channel's cells can
be impossible to edit. A server-side "all cells present must be complete" rule
would then block such a group forever, with no way to fix it from the UI. The
server therefore only guarantees the hard, unambiguous part ("an empty week
must never be submitted"); the finer completeness rule lives in the UI.
*/

-- ─── 1. "Has content" predicate ─────────────────────────────────────────────
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

      -- A deliberate quota of 0 counts as content: it means "sell nothing here".
      IF (v_cell -> 'quota') IS NOT NULL AND (v_cell -> 'quota') <> 'null'::jsonb THEN
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

-- ─── 2. submit_week: refuse an empty week ───────────────────────────────────
-- Same body as 20261007121041_add_atomic_submit_week_rpc.sql, with the
-- content gate inserted before save_week.
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
BEGIN
  IF p_submission_status NOT IN ('on_time', 'late') THEN
    RAISE EXCEPTION 'Invalid submission status';
  END IF;

  -- An empty week must never be submittable: the weekly exercise is the
  -- pricing/quota decision itself.
  IF NOT public.week_decision_has_content(p_week_data) THEN
    RAISE EXCEPTION 'WEEK_INCOMPLETE: week % carries no pricing/quota content; an empty week cannot be submitted', p_week_key
      USING ERRCODE = '40012';
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

-- ─── 3. Grants ──────────────────────────────────────────────────────────────
-- submit_week is SECURITY INVOKER, so the browser roles need execute rights on
-- the helper it calls.
REVOKE ALL ON FUNCTION public.week_decision_has_content(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.week_decision_has_content(jsonb) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_week(uuid, text, jsonb, text, text, timestamptz, text) TO anon, authenticated;
