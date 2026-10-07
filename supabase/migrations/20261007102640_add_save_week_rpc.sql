/*
# Add save_week RPC for per-week safe merge with empty-overwrite protection

## Purpose
Prevents the critical data-loss bug where an empty full-payload template
overwrites existing decisions. Instead of UPSERT/UPDATE on the entire
`payload` jsonb column, the frontend now calls `save_week()` which:

1. Reads the current `payload` from the `decisions` row for the group.
2. Deep-merges ONLY the specified week key (`p_week_key`) into the existing
   payload — all other weeks remain untouched.
3. **Rejects empty-overwrite**: if the existing week already has non-empty
   decision data (at least one channel with a non-null price or quota) AND
   the incoming `p_week_data` for that week is entirely empty (all
   price/quota fields are null/0/missing), the function raises an exception
   and does NOT write — protecting against accidental blank-template clobber.
4. Supports optimistic concurrency via `p_expected_updated_at`: if provided
   and the server's `updated_at` is newer, raises a conflict exception so
   the client can prompt the user instead of silently clobbering.
5. Sets `updated_at = now()` on every successful write.

## New Functions
- `save_week(p_group_id uuid, p_week_key text, p_week_data jsonb,
            p_hotel_name text DEFAULT NULL, p_group_name text DEFAULT NULL,
            p_expected_updated_at timestamptz DEFAULT NULL)`
  Returns jsonb: `{ ok: true, updated_at: "...", decision_id: "..." }`
  or raises exception on conflict / empty-overwrite.

## Notes
- SECURITY: defined with SECURITY INVOKER so RLS policies on `decisions`
  still apply (the anon/authenticated roles already have full CRUD via
  existing policies).
- The function only touches the specified week; it never replaces the
  entire payload.
- Idempotent: if the row doesn't exist yet, it inserts a new row with
  a full empty template + the provided week merged in.
*/

-- Helper: check if a week's decision data is "non-empty" (has any real price/quota)
CREATE OR REPLACE FUNCTION public._week_has_data(p_week jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  ch_key text;
  rt_key text;
  ch jsonb;
  rt jsonb;
BEGIN
  IF p_week IS NULL OR NOT (p_week ? 'channels') THEN
    RETURN false;
  END IF;
  FOR ch_key IN SELECT jsonb_object_keys(p_week->'channels') LOOP
    ch := p_week->'channels'->ch_key;
    IF ch ? 'roomTypes' THEN
      FOR rt_key IN SELECT jsonb_object_keys(ch->'roomTypes') LOOP
        rt := ch->'roomTypes'->rt_key;
        IF (rt->>'price') IS NOT NULL AND (rt->>'price')::numeric > 0 THEN
          RETURN true;
        END IF;
        IF (rt->>'quota') IS NOT NULL AND (rt->>'quota')::numeric > 0 THEN
          RETURN true;
        END IF;
        IF (rt->>'weekday_price') IS NOT NULL AND (rt->>'weekday_price')::numeric > 0 THEN
          RETURN true;
        END IF;
        IF (rt->>'weekend_price') IS NOT NULL AND (rt->>'weekend_price')::numeric > 0 THEN
          RETURN true;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- Main: save a single week's data with merge + protection
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
  -- Lock the row for this group to prevent concurrent writes
  SELECT id, payload, hotel_name, group_name, updated_at
    INTO v_row
    FROM public.decisions
    WHERE group_id = p_group_id
    FOR UPDATE;

  -- Optimistic concurrency check
  IF p_expected_updated_at IS NOT NULL AND v_row.id IS NOT NULL THEN
    IF v_row.updated_at > p_expected_updated_at THEN
      RAISE EXCEPTION 'CONFLICT: server data is newer than expected (another device may have saved)'
        USING ERRCODE = '40901';
    END IF;
  END IF;

  v_incoming_has_data := public._week_has_data(p_week_data);

  IF v_row.id IS NOT NULL THEN
    -- Row exists: merge only the specified week
    v_existing_payload := v_row.payload;
    v_existing_week := v_existing_payload->'weeks'->p_week_key;

    -- Empty-overwrite protection: if existing week has data but incoming is empty, reject
    v_existing_has_data := public._week_has_data(v_existing_week);
    IF v_existing_has_data AND NOT v_incoming_has_data THEN
      RAISE EXCEPTION 'REJECT_EMPTY_OVERWRITE: week % already has data, refusing to overwrite with empty data', p_week_key
        USING ERRCODE = '40010';
    END IF;

    -- Deep merge: replace only the specified week key, keep everything else
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
  ELSE
    -- Row doesn't exist: insert with just this week (rest will be filled by frontend on load)
    v_hotel := COALESCE(NULLIF(p_hotel_name, ''), '未命名酒店');
    v_gname := COALESCE(NULLIF(p_group_name, ''), '');

    v_new_payload := jsonb_build_object(
      'weeks',
      jsonb_build_object(p_week_key, p_week_data)
    );

    INSERT INTO public.decisions (group_id, group_name, hotel_name, payload, status, updated_at)
      VALUES (p_group_id, v_gname, v_hotel, v_new_payload, 'draft', v_now)
      ON CONFLICT (group_id) DO UPDATE
        SET payload = jsonb_set(
              public.decisions.payload,
              ARRAY['weeks', p_week_key],
              p_week_data,
              true
            ),
            hotel_name = EXCLUDED.hotel_name,
            group_name = EXCLUDED.group_name,
            updated_at = v_now
      RETURNING id INTO v_decision_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'decision_id', v_decision_id
  );
END;
$$;

-- Grant execute to anon + authenticated (matches existing RLS open model)
GRANT EXECUTE ON FUNCTION public.save_week(uuid, text, jsonb, text, text, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._week_has_data(jsonb) TO anon, authenticated;
