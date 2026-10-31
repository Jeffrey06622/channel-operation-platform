/**
 * Quota (房间数量) submission gate — verification harness.
 *
 * Run:  npm run verify:quota
 *
 * Covers the required scenarios plus the out-of-range case:
 *   1. quota missing (null / undefined / NaN)  -> blocked
 *   2. quota = 0 (and negative)                -> blocked
 *   3. quota out of range (per cell, aggregate)-> blocked
 *   4. quota 1..inventory                      -> accepted (submission allowed)
 *
 * Asserted at two levels:
 *   - `quotaSubmissionError` : 单格规则（前端唯一真源）
 *   - `validateWeek`         : 提交入口校验（前端按钮 + 服务端 40013 的镜像规则）
 *
 * Migration 20261019100000 enforces the same rule server-side inside
 * `submit_week`, before `save_week`, so a rejection persists nothing.
 */
import { quotaSubmissionError, validateWeek, buildQuotaOverview } from '../src/calc';
import { CHANNELS, ROOM_TYPES, emptyDecisionPayload } from '../src/domain';
import type { DecisionPayload, RoomTypeKey } from '../src/types';

let failures = 0;
let checks = 0;

function assert(condition: boolean, label: string, detail = ''): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// Legal baseline: 6 channels x quotas that respect each room type's inventory
// (高级房 8x6=48<=50, 豪华房 6x6=36<=40, 套房 1x6=6<=10, 合计 90<=100).
const BASELINE: Record<RoomTypeKey, number> = { superior: 8, deluxe: 6, suite: 1 };

function buildWeek(quotas: Record<RoomTypeKey, number | null>): DecisionPayload {
  const payload = emptyDecisionPayload(CHANNELS, ROOM_TYPES);
  const week = payload.weeks.wk5;
  for (const ch of CHANNELS) {
    for (const rt of ROOM_TYPES) {
      week.channels[ch.key].roomTypes[rt.key] = {
        price: 1000,
        quota: quotas[rt.key],
        weekend_pricing_enabled: false,
        weekend_days: [],
        weekday_price: null,
        weekend_price: null,
      };
    }
  }
  return payload;
}

function allCells(value: number | null): Record<RoomTypeKey, number | null> {
  return { superior: value, deluxe: value, suite: value };
}

// ─── 1. Field-level rule ────────────────────────────────────────────────────
section('1. quotaSubmissionError（单格规则，以高级房房量 50 为例）');
assert(quotaSubmissionError(null, 50) === '配额未填写', '缺失(null) -> 拦截', String(quotaSubmissionError(null, 50)));
assert(quotaSubmissionError(undefined, 50) === '配额未填写', '缺失(undefined) -> 拦截');
assert(quotaSubmissionError(Number.NaN, 50) === '配额未填写', '缺失(NaN) -> 拦截');
assert(quotaSubmissionError(0, 50) === '配额不能为 0 或负数', '为 0 -> 拦截', String(quotaSubmissionError(0, 50)));
assert(quotaSubmissionError(-3, 50) === '配额不能为 0 或负数', '为负 -> 拦截');
assert(quotaSubmissionError(51, 50) === '不得超过该房型房量 50 间', '超出房量(51>50) -> 拦截', String(quotaSubmissionError(51, 50)));
assert(quotaSubmissionError(2.5, 50) === '配额需为整数', '非整数 -> 拦截');
assert(quotaSubmissionError(1, 50) === null, '正常值 1 -> 通过');
assert(quotaSubmissionError(50, 50) === null, '边界值 50（等于房量）-> 通过');

// ─── 2. Week-level rule (this gates the submit button) ──────────────────────
section('2. validateWeek（提交入口校验，6 渠道 × 3 房型 = 18 格）');

const missing = validateWeek(buildWeek(allCells(null)), 'wk5');
assert(
  missing.length === 18 && missing.every((e) => e.includes('配额未填写')),
  '配额全部缺失 -> 18 条拦截，提交被阻止',
  `实际 ${missing.length} 条：${missing[0] ?? '-'}`,
);

const zero = validateWeek(buildWeek(allCells(0)), 'wk5');
assert(
  zero.length === 18 && zero.every((e) => e.includes('配额不能为 0 或负数')),
  '配额全部为 0 -> 18 条拦截，提交被阻止',
  `实际 ${zero.length} 条：${zero[0] ?? '-'}`,
);

const ok = validateWeek(buildWeek(BASELINE), 'wk5');
assert(ok.length === 0, '正常值（高级8/豪华6/套房1，合计90）-> 无错误，可提交', ok.join(' | '));

// Single cell left at 0: must be pinpointed.
const mixed = buildWeek(BASELINE);
mixed.weeks.wk5.channels.ctrip.roomTypes.superior.quota = 0;
const mixedErrors = validateWeek(mixed, 'wk5');
assert(
  mixedErrors.length === 1 &&
    mixedErrors[0].includes('携程-高级房') &&
    mixedErrors[0].includes('配额不能为 0 或负数'),
  '单格为 0 -> 精确定位「携程-高级房」并拦截',
  mixedErrors.join(' | '),
);

// Single cell above the room type inventory.
const over = buildWeek(BASELINE);
over.weeks.wk5.channels.xhs.roomTypes.suite.quota = 11;
const overErrors = validateWeek(over, 'wk5');
assert(
  overErrors.some((e) => e.includes('小红书种草-套房') && e.includes('不得超过该房型房量 10 间')),
  '套房 11 > 房量 10 -> 拦截并提示房量',
  overErrors.join(' | '),
);

// Aggregate over-allocation across channels for one room type.
const aggregate = buildWeek(BASELINE);
for (const ch of CHANNELS) {
  aggregate.weeks.wk5.channels[ch.key].roomTypes.superior.quota = 10;
}
const aggregateErrors = validateWeek(aggregate, 'wk5');
assert(
  aggregateErrors.some((e) => e.includes('高级房') && e.includes('超过该房型房量 50 间')),
  '高级房各渠道合计 60 > 50 -> 按房型房量拦截',
  aggregateErrors.join(' | '),
);

// ─── 3. Regression: the production case (prices complete, quotas empty) ─────
section('3. 回归：酒管25091 第6组 wk5（价格齐全、配额全空，旧版本可提交）');
const productionCase = emptyDecisionPayload(CHANNELS, ROOM_TYPES);
for (const ch of CHANNELS) {
  for (const rt of ROOM_TYPES) {
    productionCase.weeks.wk5.channels[ch.key].roomTypes[rt.key] = {
      price: null,
      quota: null,
      weekend_pricing_enabled: true,
      weekend_days: [5, 6],
      weekday_price: 1000,
      weekend_price: 1200,
    };
  }
}
const prodErrors = validateWeek(productionCase, 'wk5');
assert(
  prodErrors.length === 36 &&
    prodErrors.every((e) => e.includes('配额未填写')) &&
    prodErrors.filter((e) => e.includes('工作日配额')).length === 18 &&
    prodErrors.filter((e) => e.includes('周末配额')).length === 18,
  '旧版本可提交的同一份数据 -> 现在 36 条配额错误（工作日+周末各18），无法提交',
  `实际 ${prodErrors.length} 条：${prodErrors[0] ?? '-'}`,
);

// ─── 4. Weekend split quotas (工作日/周末配额分别填写) ───────────────────────
section('4. 周末价模式：工作日配额与周末配额分别校验');

type SplitMap = {
  wd?: Partial<Record<RoomTypeKey, number | null>>;
  we?: Partial<Record<RoomTypeKey, number | null>>;
  legacy?: Partial<Record<RoomTypeKey, number | null>>;
};

function buildWeekendWeek(split: SplitMap): DecisionPayload {
  const payload = emptyDecisionPayload(CHANNELS, ROOM_TYPES);
  const week = payload.weeks.wk5;
  for (const ch of CHANNELS) {
    for (const rt of ROOM_TYPES) {
      week.channels[ch.key].roomTypes[rt.key] = {
        price: null,
        quota: split.legacy && rt.key in split.legacy ? (split.legacy[rt.key] as number | null) : null,
        weekend_pricing_enabled: true,
        weekend_days: [5, 6],
        weekday_price: 1000,
        weekend_price: 1200,
        ...(split.wd && rt.key in split.wd ? { weekday_quota: split.wd[rt.key] as number | null } : {}),
        ...(split.we && rt.key in split.we ? { weekend_quota: split.we[rt.key] as number | null } : {}),
      };
    }
  }
  return payload;
}

// 4.1 历史数据回显：只有旧版 quota 时，两个周期都回退到它 -> 可提交。
const legacyOnly = validateWeek(buildWeekendWeek({ legacy: BASELINE }), 'wk5');
assert(
  legacyOnly.length === 0,
  '历史数据（只有旧版 quota）-> 回退回显，可提交',
  legacyOnly.join(' | '),
);

// 4.2 工作日配额超房量：930 > 50 -> 拦截并指明「工作日配额」。
const wdOver = validateWeek(
  buildWeekendWeek({ wd: { superior: 930, deluxe: 6, suite: 1 }, we: BASELINE }),
  'wk5',
);
assert(
  wdOver.some((e) => e.includes('工作日配额') && e.includes('超过该房型房量 50 间')),
  '工作日配额 930 > 房量 50 -> 拦截',
  wdOver.join(' | '),
);

// 4.3 周末配额为 0 -> 拦截并指明「周末配额」。
const weZero = validateWeek(
  buildWeekendWeek({ wd: BASELINE, we: { superior: 0, deluxe: 6, suite: 1 } }),
  'wk5',
);
assert(
  weZero.some((e) => e.includes('周末配额') && e.includes('不能为 0 或负数')),
  '周末配额为 0 -> 拦截',
  weZero.join(' | '),
);

// 4.4 工作日配额缺失（无旧版 quota 兜底）-> 拦截。
const wdMissing = validateWeek(buildWeekendWeek({ we: BASELINE }), 'wk5');
assert(
  wdMissing.some((e) => e.includes('工作日配额') && e.includes('未填写')),
  '工作日配额缺失 -> 拦截',
  wdMissing.join(' | '),
);

// 4.5 拆分配额正常值：工作日 8/6/1，周末 8/6/1 -> 可提交。
const splitOk = validateWeek(buildWeekendWeek({ wd: BASELINE, we: BASELINE }), 'wk5');
assert(
  splitOk.length === 0,
  '工作日与周末配额均为正常值 -> 无错误，可提交',
  splitOk.join(' | '),
);

// 4.6 周末配额按房型汇总：各渠道周末 9 × 6 = 54 > 50 -> 按房型房量拦截。
const weAggregate = validateWeek(
  buildWeekendWeek({ wd: BASELINE, we: { superior: 9, deluxe: 6, suite: 1 } }),
  'wk5',
);
assert(
  weAggregate.some((e) => e.includes('周末配额之和 54') && e.includes('超过该房型房量 50 间')),
  '各渠道周末配额之和 54 > 50 -> 按房型房量拦截',
  weAggregate.join(' | '),
);

// ─── 5. 配额总览：配额总数 / 已用量 / 剩余量 / 配额状态 ─────────────────────
section('5. buildQuotaOverview（配额总览，本地计算、无新增后端字段）');

// 5.1 整周未填写 -> allBlank，used 为 null（与填 0 区分）
const blankOv = buildQuotaOverview(emptyDecisionPayload(CHANNELS, ROOM_TYPES).weeks.wk5, null);
assert(blankOv.allBlank === true, '整周空白 -> allBlank = true（界面显示空状态提示）');
assert(blankOv.total.weekday.used === null, '整周空白 -> 已用量为 null 而非 0');
assert(blankOv.total.status === 'blank', '整周空白 -> 状态 = blank/未填写', blankOv.total.status);

// 5.2 正常分配：高级房 8×6=48（房量 50）-> 未排满，剩余 2
const baseOv = buildQuotaOverview(buildWeek(BASELINE).weeks.wk5, null);
const superiorRow = baseOv.rows.find((r) => r.key === 'superior')!;
assert(superiorRow.cap === 50, '高级房 配额总数 = 房量 50 间', String(superiorRow.cap));
assert(superiorRow.weekday.used === 48, '高级房 已用量 = 8×6 = 48 间', String(superiorRow.weekday.used));
assert(superiorRow.weekday.remaining === 2, '高级房 剩余量 = 50-48 = 2 间', String(superiorRow.weekday.remaining));
assert(superiorRow.status === 'partial', '高级房 状态 = 未排满', superiorRow.status);
assert(baseOv.total.weekday.used === 90, '酒店合计 已用量 = 48+36+6 = 90 间', String(baseOv.total.weekday.used));
assert(baseOv.total.weekday.remaining === 10, '酒店合计 剩余量 = 100-90 = 10 间');
assert(baseOv.total.status === 'partial', '酒店合计 状态 = 未排满');

// 5.3 超额：高级房每渠道 10 间 ×6 = 60 > 50
const overOv = buildQuotaOverview(buildWeek({ superior: 10, deluxe: 6, suite: 1 }).weeks.wk5, null);
const overRow = overOv.rows.find((r) => r.key === 'superior')!;
assert(overRow.status === 'over', '超额 -> 状态 = over/超额', overRow.status);
assert(overRow.weekday.remaining === -10, '超额 -> 剩余量为负（-10），界面显示“超额 10”', String(overRow.weekday.remaining));

// 5.4 配额为 0 -> 状态 empty/未投放，剩余 = 房量
const zeroOv = buildQuotaOverview(buildWeek(allCells(0)).weeks.wk5, null);
assert(zeroOv.total.status === 'empty', '配额全为 0 -> 状态 = empty/未投放', zeroOv.total.status);
assert(zeroOv.total.weekday.used === 0, '配额全为 0 -> 已用量 0（区别于未填写）', String(zeroOv.total.weekday.used));
assert(zeroOv.total.weekday.remaining === 100, '配额全为 0 -> 剩余 = 总房量 100 间');

// 5.5 排满：套房 1×... 构造 50/40/10 恰好排满需要非整分配，改用高级房每渠道 8 且房量被临时参数改成 48
const capOverrideOv = buildQuotaOverview(buildWeek({ superior: 8, deluxe: 0, suite: 0 }).weeks.wk5, {
  roomTypes: { superior: { key: 'superior', name: '高级房', inventory: 48, priceMultiplier: 1 } },
} as never);
const fullRow = capOverrideOv.rows.find((r) => r.key === 'superior')!;
assert(fullRow.weekday.used === 48 && fullRow.cap === 48, '恰好排满 -> 已用 = 房量', `${fullRow.weekday.used}/${fullRow.cap}`);
assert(fullRow.status === 'full', '恰好排满 -> 状态 = full/已排满', fullRow.status);

console.log(`\n结果：${checks - failures}/${checks} 通过，${failures} 失败`);
if (failures > 0) process.exit(1);
