/*
# Add atomic submit_week RPC

## Purpose
Make a student's save-and-submit action one database transaction. The
existing `save_week` function remains the single-week merge and protection
primitive; `submit_week` calls it and inserts the matching submission row in
the same transaction.

## New function
- `submit_week(p_group_id, p_week_key, p_week_data, p_hotel_name,
  p_group_name, p_expected_updated_at, p_submission_status)`
  - saves only the requested week;
  - rejects empty-overwrite, stale versions, and already-submitted weeks;
  - records `week_submissions` only after the week save succeeds;
  - returns the decision id and exact server timestamp.

## Security
- The function is SECURITY INVOKER and uses the existing public RLS model.
- Execute is granted only to the existing browser roles used by this no-account
  classroom application.

## Data safety
No existing rows are deleted or rewritten by this migration.
*/

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

GRANT EXECUTE ON FUNCTION public.submit_week(uuid, text, jsonb, text, text, timestamptz, text) TO anon, authenticated;
