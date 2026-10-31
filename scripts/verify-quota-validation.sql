-- 服务端配额（房间数量）门禁校验脚本 — 只读，不写入任何业务表
--
-- 前置：已应用迁移 supabase/migrations/20261019100000_require_valid_quota_on_submit.sql
-- 用法：在 Supabase SQL Editor / psql 中整段执行，比对最后一列的期望结果。
--
-- 覆盖场景：缺失(null) / 为 0 / 超出房量 / 正常值
-- 期望：前三种返回非空错误文本（提交被 40013 拦截），最后一种返回 NULL（可提交）。

-- 构造辅助：按给定 quota 生成 6 渠道 × 3 房型的周数据
CREATE OR REPLACE FUNCTION pg_temp.mk_week(p_quota numeric)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'channels', jsonb_build_object(
      'ctrip', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', p_quota),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', p_quota),
        'suite',    jsonb_build_object('price', 2200, 'quota', p_quota))),
      'meituan', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', p_quota),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', p_quota),
        'suite',    jsonb_build_object('price', 2200, 'quota', p_quota))),
      'corporate', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', p_quota),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', p_quota),
        'suite',    jsonb_build_object('price', 2200, 'quota', p_quota))),
      'direct', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', p_quota),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', p_quota),
        'suite',    jsonb_build_object('price', 2200, 'quota', p_quota))),
      'douyin', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', p_quota),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', p_quota),
        'suite',    jsonb_build_object('price', 2200, 'quota', p_quota))),
      'xhs', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', p_quota),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', p_quota),
        'suite',    jsonb_build_object('price', 2200, 'quota', p_quota)))
    ),
    'specialFactors', '[]'::jsonb
  );
$$;

-- 场景 1：配额缺失（null）→ 期望：拦截（返回"配额未填写"）
SELECT '1. 配额缺失(null)' AS 场景,
       public.week_quota_problem(pg_temp.mk_week(NULL)) AS 服务端判定,
       '应返回错误文本，提交被 40013 拦截' AS 期望;

-- 场景 2：配额为 0 → 期望：拦截（返回"配额不能为 0 或负数"）
SELECT '2. 配额为 0' AS 场景,
       public.week_quota_problem(pg_temp.mk_week(0)) AS 服务端判定,
       '应返回错误文本，提交被 40013 拦截' AS 期望;

-- 场景 3：配额超出房量（套房房量 10，这里填 11）→ 期望：拦截
SELECT '3. 配额超房量(套房 11 > 10)' AS 场景,
       public.week_quota_problem(
         jsonb_set(jsonb_set(pg_temp.mk_week(1), '{channels,xhs,roomTypes,suite,quota}', '11'::jsonb),
                   '{channels,xhs,roomTypes,suite,price}', '2200'::jsonb)
       ) AS 服务端判定,
       '应返回错误文本，提交被 40013 拦截' AS 期望;

-- 场景 4：正常值（高级8/豪华6/套房1，均未超房量）→ 期望：NULL（可提交）
WITH legal AS (
  SELECT jsonb_build_object(
    'channels', jsonb_build_object(
      'ctrip', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', 8),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', 6),
        'suite',    jsonb_build_object('price', 2200, 'quota', 1))),
      'meituan', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', 8),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', 6),
        'suite',    jsonb_build_object('price', 2200, 'quota', 1))),
      'corporate', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', 8),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', 6),
        'suite',    jsonb_build_object('price', 2200, 'quota', 1))),
      'direct', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', 8),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', 6),
        'suite',    jsonb_build_object('price', 2200, 'quota', 1))),
      'douyin', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', 8),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', 6),
        'suite',    jsonb_build_object('price', 2200, 'quota', 1))),
      'xhs', jsonb_build_object('roomTypes', jsonb_build_object(
        'superior', jsonb_build_object('price', 1000, 'quota', 8),
        'deluxe',   jsonb_build_object('price', 1300, 'quota', 6),
        'suite',    jsonb_build_object('price', 2200, 'quota', 1)))
    ),
    'specialFactors', '[]'::jsonb
  ) AS week
)
SELECT '4. 正常值(高级8/豪华6/套房1)' AS 场景,
       public.week_quota_problem((SELECT week FROM legal)) AS 服务端判定,
       '应为 NULL，允许提交' AS 期望;

-- 附：确认被拦截的提交不会落库（直接用匿名权限调用会抛 40013，可在前端或 RPC 测试中观察）
-- SELECT public.submit_week('<group_id>', 'wk5', pg_temp.mk_week(NULL), NULL, NULL, NULL, 'on_time');
-- 期望：ERROR: QUOTA_INVALID: ...  SQLSTATE 40013，且 decisions/week_submissions 均无新写入。
