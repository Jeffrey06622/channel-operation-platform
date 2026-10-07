/*
# Protect decision history and submitted weeks

## Purpose
Create a server-side recovery trail and strengthen the per-week save guard.
This migration does not delete or rewrite any existing decision data.

## New table
- `decision_history`
  - `id`: recovery snapshot identifier.
  - `decision_id`: original decision row identifier.
  - `group_id`: group owning the decision.
  - `group_name`: group label at the time of the snapshot.
  - `hotel_name`: hotel label at the time of the snapshot.
  - `payload`: complete decision payload immediately before an update.
  - `status`: decision status immediately before an update.
  - `updated_at`: original decision timestamp.
  - `captured_at`: snapshot creation timestamp.

## Changed server behavior
1. Every update to `decisions` automatically stores the previous complete row in
   `decision_history` before the update is applied.
2. `save_week` now rejects writes to a week already present in
   `week_submissions`, even if a caller bypasses the browser UI.
3. `save_week` returns the exact timestamp including milliseconds, so the next
   optimistic-concurrency save does not produce a false conflict.
4. A concurrent first insert is re-read and checked rather than silently
   replacing another caller's payload.

## Security
- `decision_history` has RLS enabled and is not readable or writable by anon or
  authenticated clients. Only the server-side trigger owner can write it.
- The trigger function uses a fixed `search_path` and has no client EXECUTE grant.
- Four explicit policies are provided for the internal `service_role`; regular
  browser roles remain denied.

## Recovery note
This preserves future versions. It cannot recreate values that were already
removed before this migration unless a teacher-exported backup or Supabase
point-in-time backup is available.
*/

CREATE TABLE IF NOT EXISTS public.decision_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL,
  group_id uuid NOT NULL,
  group_name text NOT NULL,
  hotel_name text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.decision_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.decision_history FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.decision_history TO service_role;

DROP POLICY IF EXISTS "service_role_select_decision_history" ON public.decision_history;
CREATE POLICY "service_role_select_decision_history"
ON public.decision_history FOR SELECT
TO service_role
USING (true);

DROP POLICY IF EXISTS "service_role_insert_decision_history" ON public.decision_history;
CREATE POLICY "service_role_insert_decision_history"
ON public.decision_history FOR INSERT
TO service_role
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_update_decision_history" ON public.decision_history;
CREATE POLICY "service_role_update_decision_history"
ON public.decision_history FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_delete_decision_history" ON public.decision_history;
CREATE POLICY "service_role_delete_decision_history"
ON public.decision_history FOR DELETE
TO service_role
USING (true);

CREATE OR REPLACE FUNCTION public.capture_decision_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.decision_history (
    decision_id,
    group_id,
    group_name,
    hotel_name,
    payload,
    status,
    updated_at
  )
  VALUES (
    OLD.id,
    OLD.group_id,
    OLD.group_name,
    OLD.hotel_name,
    OLD.payload,
    OLD.status,
    OLD.updated_at
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_decision_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS decisions_capture_history ON public.decisions;
CREATE TRIGGER decisions_capture_history
BEFORE UPDATE ON public.decisions
FOR EACH ROW
EXECUTE FUNCTION public.capture_decision_history();

CREATE OR REPLACE FUNCTION public.save_week(
  p_group_id uuid,
  p_week_key text,
  p_week_data jsonb,
  p_hotel_name text DEFAULT NULL,
  p_group_name text DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_row RECORD;
  v_existing_payload jsonb;
  v_new_payload jsonb;
  v_decision_id uuid;
  v_existing_week jsonb;
  v_incoming_has_data boolean;
  v_existing_has_data boolean;
  v_now timestamptz := now();
  v_hotel text;
  v_gname text;
BEGIN
  IF p_group_id IS NULL OR p_week_key IS NULL OR p_week_key = '' OR p_week_data IS NULL OR jsonb_typeof(p_week_data) <> 'object' THEN
    RAISE EXCEPTION 'Invalid week data';
  END IF;

  SELECT id, payload, hotel_name, group_name, updated_at
    INTO v_row
    FROM public.decisions
    WHERE group_id = p_group_id
    FOR UPDATE;

  IF v_row.id IS NULL THEN
    v_hotel := COALESCE(NULLIF(p_hotel_name, ''), '未命名酒店');
    v_gname := COALESCE(NULLIF(p_group_name, ''), '');
    INSERT INTO public.decisions (group_id, group_name, hotel_name, payload, status, updated_at)
      VALUES (
        p_group_id,
        v_gname,
        v_hotel,
        jsonb_build_object('weeks', jsonb_build_object(p_week_key, p_week_data)),
        'draft',
        v_now
      )
      ON CONFLICT (group_id) DO NOTHING
      RETURNING id INTO v_decision_id;

    -- A concurrent first save may have won the unique constraint. Re-read it
    -- under a row lock and apply the same protections as the normal path.
    IF v_decision_id IS NULL THEN
      SELECT id, payload, hotel_name, group_name, updated_at
        INTO v_row
        FROM public.decisions
        WHERE group_id = p_group_id
        FOR UPDATE;
    ELSE
      RETURN jsonb_build_object(
        'ok', true,
        'updated_at', to_jsonb(v_now),
        'decision_id', v_decision_id
      );
    END IF;
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at > p_expected_updated_at THEN
    RAISE EXCEPTION 'CONFLICT: server data is newer than expected'
      USING ERRCODE = '40901';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.week_submissions
    WHERE group_id = p_group_id AND week_key = p_week_key
  ) THEN
    RAISE EXCEPTION 'SUBMITTED_WEEK_LOCKED: submitted weeks are read-only'
      USING ERRCODE = '40011';
  END IF;

  v_existing_payload := COALESCE(v_row.payload, jsonb_build_object('weeks', jsonb_build_object()));
  v_existing_week := v_existing_payload->'weeks'->p_week_key;
  v_incoming_has_data := public._week_has_data(p_week_data);
  v_existing_has_data := public._week_has_data(v_existing_week);

  IF v_existing_has_data AND NOT v_incoming_has_data THEN
    RAISE EXCEPTION 'REJECT_EMPTY_OVERWRITE: week % already has data, refusing to overwrite with empty data', p_week_key
      USING ERRCODE = '40010';
  END IF;

  v_new_payload := jsonb_set(
    v_existing_payload,
    ARRAY['weeks', p_week_key],
    p_week_data,
    true
  );

  v_hotel := COALESCE(NULLIF(p_hotel_name, ''), v_row.hotel_name);
  v_gname := COALESCE(NULLIF(p_group_name, ''), v_row.group_name);

  UPDATE public.decisions
    SET payload = v_new_payload,
        hotel_name = v_hotel,
        group_name = v_gname,
        updated_at = v_now
    WHERE id = v_row.id;

  v_decision_id := v_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_at', to_jsonb(v_now),
    'decision_id', v_decision_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_week(uuid, text, jsonb, text, text, timestamptz) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._week_has_data(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._week_has_data(jsonb) TO anon, authenticated;
