/*
# Batch 2 database hardening

## Purpose
Close the password-exposure and settings-integrity gaps left by the original
no-auth classroom design. No existing decision data is deleted or rewritten.

## Changes

1. `app_settings` single-row enforcement
   - If more than one settings row exists (a known failure mode that breaks
     the frontend's `.maybeSingle()` reads), keep the most recently updated
     row and salvage a configured `teacher_password_hash` from the others.
   - Add a CHECK+UNIQUE single-row guard so a second row can never be created.

2. Server-side login/password RPCs (pgcrypto)
   - `verify_group_login(p_group_id, p_password)` — compares the group
     password hash server-side, so `groups.password_hash` no longer needs to
     be readable by the browser.
   - `verify_teacher_login(p_password)` — same for the teacher password.
   - `change_group_password(p_group_id, p_old_password, p_new_password)` —
     verifies the old password server-side before rotating.
   - `change_teacher_password(p_old_password, p_new_password)` — same for the
     teacher password.
   - `reset_group_password(p_group_id)` — teacher reset to the shared default
     password `000000`.
   All are SECURITY DEFINER with a pinned search_path and return
   `{ok: true|false, reason: ...}` instead of leaking hashes.

3. `save_week` re-asserted to the protected version (per-week merge,
   submitted-week lock, optimistic concurrency, empty-overwrite rejection).
   Re-declaring here guarantees the live database runs the newest body even
   if an earlier migration was skipped.

4. `groups.password_plain` kept but made unreadable
   - The plaintext password column is no longer part of the browser-readable
     surface (dropped from the SELECT grant). Password rotation goes through
     the RPCs; students change their own passwords via
     `change_group_password`. The column itself is intentionally preserved —
     see section 4 for why it is not dropped.

5. Least-privilege column grants
   - `groups`: browsers can read only (id, name, hotel_name, class_label,
     created_at); INSERT limited to the creation columns; UPDATE revoked
     (password rotation goes through the RPCs).
   - `app_settings`: browsers can read only the non-secret settings columns;
     UPDATE limited to those same columns; INSERT/DELETE revoked.
     `teacher_password_hash` is no longer readable or writable by the
     browser at all — an anonymous visitor can no longer read it or replace
     it to take over the teacher account.

## Deployment order
The new frontend falls back to the legacy code paths whenever the RPCs are
missing, so this migration can be applied before or after the frontend
publish. Applying it AFTER the frontend publish minimizes the window in
which the legacy paths get permission errors.

## Known accepted risk
The app still runs on the anon key with no per-user Supabase Auth, so anyone
who can reach the API can still read group lists and call the RPCs. This
migration removes the passive disclosure of password material; full per-role
authorization would require a real auth layer.
*/

-- ─── 0. pgcrypto for sha256 digest ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─── 1. app_settings: dedupe to a single row + single-row guard ────────────
DO $$
DECLARE
  v_count int;
  v_keeper uuid;
  v_hash text;
BEGIN
  SELECT count(*) INTO v_count FROM public.app_settings;
  IF v_count > 1 THEN
    -- Keep the most recently updated row
    SELECT id INTO v_keeper
      FROM public.app_settings
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1;

    -- Salvage a configured teacher password hash from any row if the keeper
    -- has none (otherwise deleting the other rows would lock the teacher out)
    SELECT teacher_password_hash INTO v_hash FROM public.app_settings WHERE id = v_keeper;
    IF v_hash IS NULL OR v_hash = '' THEN
      SELECT max(teacher_password_hash) INTO v_hash
        FROM public.app_settings
        WHERE teacher_password_hash IS NOT NULL AND teacher_password_hash <> '';
      IF v_hash IS NOT NULL AND v_hash <> '' THEN
        UPDATE public.app_settings SET teacher_password_hash = v_hash WHERE id = v_keeper;
      END IF;
    END IF;

    DELETE FROM public.app_settings WHERE id <> v_keeper;
  END IF;
END $$;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS single_row boolean NOT NULL DEFAULT true;

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_single_row_check;
ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_single_row_check CHECK (single_row);

CREATE UNIQUE INDEX IF NOT EXISTS app_settings_single_row_key
  ON public.app_settings (single_row);

-- ─── 2. Login / password RPCs ──────────────────────────────────────────────

-- Group login: verify password server-side without exposing the hash
CREATE OR REPLACE FUNCTION public.verify_group_login(
  p_group_id uuid,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
BEGIN
  IF p_group_id IS NULL OR p_password IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;
  SELECT password_hash INTO v_hash FROM public.groups WHERE id = p_group_id;
  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'group_not_found');
  END IF;
  IF v_hash = encode(extensions.digest('hotel-decision-salt::' || p_password, 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'wrong_password');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_group_login(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_group_login(uuid, text) TO anon, authenticated;

-- Teacher login: verify password server-side without exposing the hash
CREATE OR REPLACE FUNCTION public.verify_teacher_login(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
BEGIN
  IF p_password IS NULL OR p_password = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;
  SELECT teacher_password_hash INTO v_hash
    FROM public.app_settings
    ORDER BY updated_at DESC
    LIMIT 1;
  IF v_hash IS NULL OR v_hash = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_configured');
  END IF;
  IF v_hash = encode(extensions.digest('hotel-decision-salt::' || p_password, 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'wrong_password');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_teacher_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_teacher_login(text) TO anon, authenticated;

-- Student self-service password change: old password verified server-side
CREATE OR REPLACE FUNCTION public.change_group_password(
  p_group_id uuid,
  p_old_password text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_new_hash text;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'password_too_short');
  END IF;
  SELECT password_hash INTO v_hash FROM public.groups WHERE id = p_group_id;
  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'group_not_found');
  END IF;
  IF v_hash <> encode(extensions.digest('hotel-decision-salt::' || p_old_password, 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_old_password');
  END IF;
  v_new_hash := encode(extensions.digest('hotel-decision-salt::' || p_new_password, 'sha256'), 'hex');
  UPDATE public.groups SET password_hash = v_new_hash WHERE id = p_group_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.change_group_password(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_group_password(uuid, text, text) TO anon, authenticated;

-- Teacher password change: old password verified server-side
CREATE OR REPLACE FUNCTION public.change_teacher_password(
  p_old_password text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_new_hash text;
BEGIN
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'password_too_short');
  END IF;
  SELECT teacher_password_hash INTO v_hash
    FROM public.app_settings
    ORDER BY updated_at DESC
    LIMIT 1;
  IF v_hash IS NULL OR v_hash = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_configured');
  END IF;
  IF v_hash <> encode(extensions.digest('hotel-decision-salt::' || p_old_password, 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_old_password');
  END IF;
  v_new_hash := encode(extensions.digest('hotel-decision-salt::' || p_new_password, 'sha256'), 'hex');
  UPDATE public.app_settings SET teacher_password_hash = v_new_hash;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.change_teacher_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_teacher_password(text, text) TO anon, authenticated;

-- Teacher reset of a group password to the shared default
CREATE OR REPLACE FUNCTION public.reset_group_password(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_hash text;
  v_updated int;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;
  v_default_hash := encode(extensions.digest('hotel-decision-salt::' || '000000', 'sha256'), 'hex');
  UPDATE public.groups SET password_hash = v_default_hash WHERE id = p_group_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'group_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_group_password(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_group_password(uuid) TO anon, authenticated;

-- ─── 3. save_week: re-assert the protected version ─────────────────────────
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
SET search_path = public
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

-- ─── 4. Plaintext password column ─────────────────────────────────────────
-- Kept, but NOT readable by browsers (see section 5). The original batch-2
-- plan dropped this column; the follow-up migration
-- (20261008090000_restore_group_password_view.sql) restores the teacher-side
-- "view password" feature, and dropping it here would permanently destroy the
-- plaintext of every password a student had already customised before that
-- migration runs. Keeping the column under a column-level grant is equally
-- safe: `anon` / `authenticated` get INSERT but no SELECT on it, so the value
-- is reachable only through the teacher-gated list_group_passwords() RPC.
-- (No statement here: the column is left untouched on purpose.)

-- ─── 5. Least-privilege column grants ──────────────────────────────────────

-- groups: no hash read, no direct update; writes only via RPCs
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.groups FROM anon, authenticated, PUBLIC;

GRANT SELECT (id, name, hotel_name, class_label, created_at)
  ON public.groups TO anon, authenticated;
GRANT INSERT (name, hotel_name, class_label, password_hash, password_plain)
  ON public.groups TO anon, authenticated;
GRANT DELETE ON public.groups TO anon, authenticated;

-- app_settings: secret column invisible to browsers, settings editable
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.app_settings FROM anon, authenticated, PUBLIC;

GRANT SELECT (id, current_week_key, updated_at, submission_deadline, late_submit_deadline,
              base_params, benchmark_fiscal_year, benchmark_hotel_class, channel_sim)
  ON public.app_settings TO anon, authenticated;
GRANT UPDATE (current_week_key, updated_at, submission_deadline, late_submit_deadline,
              base_params, benchmark_fiscal_year, benchmark_hotel_class, channel_sim)
  ON public.app_settings TO anon, authenticated;
