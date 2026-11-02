/*
# Add login_group RPC

1. New function
- `login_group(p_group_id uuid, p_password text)` returns jsonb.
- On a match: `{ ok: true, group: { id, name, hotel_name, class_label, created_at } }`.
- On a miss: `{ ok: false, reason: 'not_found' | 'bad_password' }`.

2. Password check
- Uses the same salted SHA-256 as the browser: sha256('hotel-decision-salt::' || password), hex.
- The password hash column is never returned to the caller.

3. Security
- SECURITY DEFINER with a fixed search_path so it can read groups.password_hash.
- EXECUTE is revoked from PUBLIC and granted to anon and authenticated, since the login screen runs as anon.
*/

CREATE OR REPLACE FUNCTION public.login_group(p_group_id uuid, p_password text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN g.id IS NULL THEN jsonb_build_object('ok', false, 'reason', 'not_found')
    WHEN g.password_hash = encode(sha256(convert_to('hotel-decision-salt::' || coalesce(p_password, ''), 'UTF8')), 'hex')
      THEN jsonb_build_object(
        'ok', true,
        'group', jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'hotel_name', g.hotel_name,
          'class_label', g.class_label,
          'created_at', g.created_at
        )
      )
    ELSE jsonb_build_object('ok', false, 'reason', 'bad_password')
  END
  FROM (SELECT 1) AS anchor
  LEFT JOIN public.groups g ON g.id = p_group_id;
$$;

REVOKE EXECUTE ON FUNCTION public.login_group(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_group(uuid, text) TO anon, authenticated;
