/*
# Batch 3 — teacher-side group password lookup

## Why
The batch-2 hardening removed `groups.password_plain` and the teacher-side
"view password" button because the column could be read by *any* anonymous
visitor holding the public anon key (the table had a plain SELECT grant).
Teachers still need the feature: students forget their group password every
lesson and the teacher has to be able to read it back to them.

## Design
The plaintext is stored again, but it is not part of the browser-readable
surface of the table:

1. `groups` keeps only column-level grants. `password_plain` is intentionally
   NOT in the SELECT grant list, so `select *` (or an explicit select of that
   column) is rejected for `anon` / `authenticated`. The grant block is
   re-asserted here so the rule also holds on a database where batch 2 was
   never applied.
2. The only way to read it is `list_group_passwords(p_teacher_password)`, a
   SECURITY DEFINER function that first verifies the **teacher** password
   server-side. Knowing the anon key alone is no longer enough to harvest the
   group passwords — the caller must also know the teacher password.

## Compatibility
`ADD COLUMN IF NOT EXISTS` means existing plaintext values survive on a
database where batch 2 was never applied; the backfill only fills rows that
are still on the shared default. Rows whose password a student had already
changed *and* whose plaintext was dropped by batch 2 cannot be recovered —
they stay NULL and the interface shows "未知" with a hint to reset.

## Accepted risk
Passwords remain recoverable (not hashed-only) by design, so that the teacher
can look them up. Whoever knows the teacher password can list every group
password. Group passwords are 6-digit classroom codes with a shared default,
not user secrets; the goal here is to stop passive bulk disclosure, not to
provide per-user authorization (which would need Supabase Auth).
*/

-- ─── 0. pgcrypto + shared hash helper ──────────────────────────────────────
-- Only install when missing, and always into `extensions` (Supabase's
-- convention, where the batch-2 migration expects to find it). Installing it
-- unconditionally without a schema would drop it into `public` on a database
-- where batch 2 has not run yet, and `extensions.digest(...)` over there would
-- then fail. The helper below resolves `digest` through search_path, so it
-- works whichever schema the extension ended up in.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
  END IF;
END $$;

-- Same construction as the client-side hashPassword():
--   sha256('hotel-decision-salt::' || password) as lowercase hex
CREATE OR REPLACE FUNCTION public._pw_hash(p_password text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest('hotel-decision-salt::' || coalesce(p_password, ''), 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public._pw_hash(text) FROM PUBLIC, anon, authenticated;

-- ─── 1. Bring the plaintext column back ────────────────────────────────────
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS password_plain text;

-- Recover every group that still uses the shared default; anything the
-- teacher or a student had customised keeps its existing value (when present).
UPDATE public.groups
   SET password_plain = '000000'
 WHERE coalesce(password_plain, '') = ''
   AND password_hash = public._pw_hash('000000');

-- ─── 2. Server-side password RPCs (complete the subsystem) ─────────────────
-- verify_group_login / verify_teacher_login / change_teacher_password are
-- normally created by the batch-2 migration. They are re-declared here with an
-- identical contract so that applying this file alone cannot leave the app
-- without a login path once it also revokes the browser's direct table access.

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
  IF v_hash = public._pw_hash(p_password) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'wrong_password');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_group_login(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_group_login(uuid, text) TO anon, authenticated;

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
  IF v_hash = public._pw_hash(p_password) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'wrong_password');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_teacher_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_teacher_login(text) TO anon, authenticated;

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
  IF v_hash <> public._pw_hash(p_old_password) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_old_password');
  END IF;
  v_new_hash := public._pw_hash(p_new_password);
  UPDATE public.app_settings SET teacher_password_hash = v_new_hash;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.change_teacher_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_teacher_password(text, text) TO anon, authenticated;

-- ─── 3. Keep the plaintext in sync on every group password change ──────────

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
  IF v_hash <> public._pw_hash(p_old_password) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_old_password');
  END IF;
  v_new_hash := public._pw_hash(p_new_password);
  UPDATE public.groups
     SET password_hash = v_new_hash,
         password_plain = p_new_password
   WHERE id = p_group_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.change_group_password(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_group_password(uuid, text, text) TO anon, authenticated;

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
  v_default_hash := public._pw_hash('000000');
  UPDATE public.groups
     SET password_hash = v_default_hash,
         password_plain = '000000'
   WHERE id = p_group_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'group_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_group_password(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_group_password(uuid) TO anon, authenticated;

-- ─── 4. The teacher-gated password listing ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_group_passwords(p_teacher_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_items jsonb;
BEGIN
  IF p_teacher_password IS NULL OR p_teacher_password = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  SELECT teacher_password_hash INTO v_hash
    FROM public.app_settings
    ORDER BY updated_at DESC
    LIMIT 1;

  IF v_hash IS NULL OR v_hash = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_configured');
  END IF;

  -- The teacher password is the gate: without it the group passwords stay
  -- unreadable even for a caller holding the public anon key.
  IF v_hash <> public._pw_hash(p_teacher_password) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_password');
  END IF;

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', g.id,
               'name', g.name,
               'class_label', g.class_label,
               'password', g.password_plain
             )
             ORDER BY g.class_label, g.name
           ),
           '[]'::jsonb
         )
    INTO v_items
    FROM public.groups g;

  RETURN jsonb_build_object('ok', true, 'passwords', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.list_group_passwords(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_group_passwords(text) TO anon, authenticated;

-- ─── 5. Re-assert least-privilege grants ───────────────────────────────────
-- Idempotent with batch 2. `password_plain` is writable on insert (so the
-- teacher's "create group" flow can record the initial password) but is NOT
-- readable: it is reachable only through list_group_passwords().
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.groups FROM anon, authenticated, PUBLIC;

GRANT SELECT (id, name, hotel_name, class_label, created_at)
  ON public.groups TO anon, authenticated;
GRANT INSERT (name, hotel_name, class_label, password_hash, password_plain)
  ON public.groups TO anon, authenticated;
GRANT DELETE ON public.groups TO anon, authenticated;

-- app_settings: the teacher password hash must stay invisible to browsers even
-- on a database where the batch-2 grant block was never applied.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.app_settings FROM anon, authenticated, PUBLIC;

GRANT SELECT (id, current_week_key, updated_at, submission_deadline, late_submit_deadline,
              base_params, benchmark_fiscal_year, benchmark_hotel_class, channel_sim)
  ON public.app_settings TO anon, authenticated;
GRANT UPDATE (current_week_key, updated_at, submission_deadline, late_submit_deadline,
              base_params, benchmark_fiscal_year, benchmark_hotel_class, channel_sim)
  ON public.app_settings TO anon, authenticated;
