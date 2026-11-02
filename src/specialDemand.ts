import type {
  BaseParams,
  CompareStatus,
  DecisionPayload,
  DecisionRow,
  FactorResponseMatrix,
  GroupResponseRow,
  GroupRow,
  ResponseStatus,
  RoomTypeDecision,
  SpecialDemandCategory,
  SpecialDemandExpected,
  SpecialDemandFactor,
  SpecialFactorMeta,
  WeekDecision,
  WeekMeta,
  ChannelDecision,
} from './types';
import { priceMin, registerSpecialFactors, resolveChannels, resolveRoomTypes } from './domain';
import { asArray, asObjectMap } from './arrayUtil';

export const FACTOR_KEY_PREFIX = 'sd_';

const HOLD_PRICE_MIN_QUOTA_USE = 60;

const CATEGORY_LABELS: Record<SpecialDemandCategory, string> = {
  event: '活动',
  holiday: '节假日',
  weather: '天气',
  competition: '竞争',
  policy: '政策',
  other: '其他',
};

const EXPECTED_LABELS: Record<SpecialDemandExpected, string> = {
  raise_price: '提价应对',
  expand_quota: '扩大配额',
  shift_mix: '调整渠道结构',
  hold_price: '保持价格',
  no_change: '维持现状',
};

export function categoryLabel(category: SpecialDemandCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function expectedResponseLabel(expected: SpecialDemandExpected): string {
  return EXPECTED_LABELS[expected] ?? expected;
}

export function factorKeyOf(factor: Pick<SpecialDemandFactor, 'id'> | null | undefined): string {
  return FACTOR_KEY_PREFIX + String(factor?.id ?? '').replace(/-/g, '').slice(0, 8);
}

export function isFactorEffective(factor: SpecialDemandFactor, week: WeekMeta): boolean {
  if (!factor.is_active) return false;
  if (factor.week_key === week.key) return true;
  const startsBeforeWeekEnds = !factor.effective_from || factor.effective_from <= week.endDate;
  const endsAfterWeekStarts = !factor.effective_to || factor.effective_to >= week.startDate;
  return startsBeforeWeekEnds && endsAfterWeekStarts;
}

function namesOf(keys: string[], list: { key: string; name: string }[]): string {
  const names = keys.map((k) => list.find((x) => x.key === k)?.name ?? k);
  return names.length > 0 ? names.join('、') : '未选择';
}

function scopeKeysOf(factor: SpecialDemandFactor | null | undefined): string[] {
  return asArray<string>(factor?.scope_keys);
}

export function describeScope(factor: SpecialDemandFactor | null | undefined, baseParams?: BaseParams | null): string {
  const scopeKeys = scopeKeysOf(factor);
  const rooms =
    factor?.scope_type === 'room_type'
      ? namesOf(scopeKeys, resolveRoomTypes(baseParams))
      : '全部房型';
  const channels =
    factor?.scope_type === 'channel'
      ? namesOf(scopeKeys, resolveChannels(baseParams))
      : '全部渠道';
  return `${rooms}／${channels}`;
}

export function describeTrigger(
  factor: Pick<SpecialDemandFactor, 'expected_response' | 'threshold'> | null | undefined,
): string {
  if (!factor) return '';
  const t = factor.threshold;
  switch (factor.expected_response) {
    case 'raise_price':
      return `受影响范围加权均价较基准价上浮 ≥ ${t}%`;
    case 'expand_quota':
      return `受影响范围配额使用率 ≥ ${t}%`;
    case 'shift_mix':
      return `受影响渠道配额占比 ≥ ${t}%`;
    case 'hold_price':
      return `价格上浮 ≤ ${t}% 且配额使用率 ≥ ${HOLD_PRICE_MIN_QUOTA_USE}%`;
    case 'no_change':
      return '维持既有策略即可';
  }
}

export interface GroupEvaluation {
  status: ResponseStatus;
  metric_value: number | null;
  detail: string;
}

const noData = (detail: string): GroupEvaluation => ({
  status: 'no_data',
  metric_value: null,
  detail,
});

function cellAt(channels: Record<string, ChannelDecision>, channelKey: string, roomKey: string): RoomTypeDecision | undefined {
  const cell = asObjectMap<RoomTypeDecision>(channels[channelKey]?.roomTypes)[roomKey];
  return cell && typeof cell === 'object' ? cell : undefined;
}

function cellPrice(cell: RoomTypeDecision, week: WeekMeta): number | null {
  const wd = cell.weekday_price;
  const we = cell.weekend_price;
  if (cell.weekend_pricing_enabled === true && wd != null && we != null && week.days > 0) {
    const weekendDays = Math.min(cell.weekend_days?.length ?? 0, week.days);
    const weekdayDays = week.days - weekendDays;
    return (wd * weekdayDays + we * weekendDays) / week.days;
  }
  return cell.price ?? null;
}

function cellQuota(cell: RoomTypeDecision): number | null {
  if (cell.weekend_pricing_enabled !== true) return cell.quota ?? null;
  const wd = cell.weekday_quota ?? cell.quota ?? null;
  const we = cell.weekend_quota ?? cell.quota ?? null;
  if (wd == null && we == null) return null;
  return (wd ?? 0) + (we ?? 0);
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
}

export function evaluateGroupResponse(
  factor: SpecialDemandFactor,
  week: WeekMeta,
  payload: DecisionPayload | null | undefined,
  baseParams: BaseParams | null,
): GroupEvaluation {
  const weekDecision = asObjectMap<WeekDecision>(payload?.weeks)[week?.key ?? ''];
  if (!weekDecision || typeof weekDecision !== 'object' || !weekDecision.channels) {
    return noData('本周未提交决策');
  }
  const channels = asObjectMap<ChannelDecision>(weekDecision.channels);

  const allChannelKeys = resolveChannels(baseParams).map((c) => c.key);
  const allRooms = resolveRoomTypes(baseParams);
  const scopeKeys = scopeKeysOf(factor);
  const affectedChannels = factor?.scope_type === 'channel' ? scopeKeys : allChannelKeys;
  const affectedRooms =
    factor?.scope_type === 'room_type'
      ? allRooms.filter((r) => scopeKeys.includes(r.key))
      : allRooms;

  let affectedQuota = 0;
  let quotaCells = 0;
  let pricedCells = 0;
  let priceSum = 0;
  let baseSum = 0;
  let weightSum = 0;
  for (const channelKey of affectedChannels) {
    for (const room of affectedRooms) {
      const cell = cellAt(channels, channelKey, room.key);
      if (!cell) continue;
      const quota = cellQuota(cell);
      if (quota != null) {
        affectedQuota += quota;
        quotaCells++;
      }
      const price = cellPrice(cell, week);
      if (price != null && price > 0) {
        const weight = Math.max(quota ?? 0, 1);
        priceSum += price * weight;
        baseSum += priceMin(channelKey, room.key, baseParams) * weight;
        weightSum += weight;
        pricedCells++;
      }
    }
  }

  if (pricedCells === 0 || quotaCells === 0) return noData('本周未填写价格/配额');

  let allQuota = 0;
  for (const channelKey of allChannelKeys) {
    for (const room of allRooms) {
      const cell = cellAt(channels, channelKey, room.key);
      const quota = cell ? cellQuota(cell) : null;
      if (quota != null) allQuota += quota;
    }
  }

  const avgPrice = priceSum / weightSum;
  const basePrice = baseSum / weightSum;
  const priceExec = basePrice > 0 ? ((avgPrice - basePrice) / basePrice) * 100 : 0;
  const capacity = affectedRooms.reduce((s, r) => s + r.inventory, 0) * week.days;
  const quotaUse = capacity > 0 ? (affectedQuota / capacity) * 100 : 0;
  const quotaShare = allQuota > 0 ? (affectedQuota / allQuota) * 100 : 0;

  const t = factor?.threshold ?? 0;
  let hit: boolean;
  let metric: number;
  switch (factor?.expected_response) {
    case 'raise_price':
      hit = priceExec >= t;
      metric = priceExec;
      break;
    case 'expand_quota':
      hit = quotaUse >= t;
      metric = quotaUse;
      break;
    case 'shift_mix':
      hit = quotaShare >= t;
      metric = quotaShare;
      break;
    case 'hold_price':
      hit = priceExec <= t && quotaUse >= HOLD_PRICE_MIN_QUOTA_USE;
      metric = priceExec;
      break;
    case 'no_change':
      hit = true;
      metric = quotaUse;
      break;
  }

  return {
    status: hit ? 'responded' : 'not_responded',
    metric_value: metric,
    detail: `均价 ${signed(priceExec)}%（¥${Math.round(basePrice)} → ¥${Math.round(avgPrice)}）｜配额使用率 ${Math.round(quotaUse)}%`,
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function compareOf(
  value: number | null,
  sampleSize: number,
  p25: number | null,
  p75: number | null,
): CompareStatus {
  if (value === null) return 'no_data';
  if (sampleSize < 3 || p25 === null || p75 === null) return 'on_par';
  if (value >= p75) return 'leading';
  if (value <= p25) return 'lagging';
  return 'on_par';
}

function toFactorMeta(f: SpecialDemandFactor | null | undefined): SpecialFactorMeta {
  return {
    key: factorKeyOf(f),
    name: f?.name ?? '',
    demandMultiplier: f?.demand_multiplier ?? 1,
    description: f?.description ?? '',
  };
}

export function registerActiveFactors(rows: SpecialDemandFactor[]): void {
  registerSpecialFactors(asArray<SpecialDemandFactor>(rows).filter((f) => f && f.is_active).map(toFactorMeta));
}

export function studentSelectableFactors(rows: SpecialDemandFactor[], week: WeekMeta | undefined): SpecialFactorMeta[] {
  return asArray<SpecialDemandFactor>(rows)
    .filter((f) => f && f.student_selectable === true && isFactorEffective(f, week as WeekMeta))
    .map(toFactorMeta);
}

export function buildResponseMatrix(
  factors: SpecialDemandFactor[],
  groups: GroupRow[],
  decisionMap: Map<string, DecisionRow>,
  week: WeekMeta,
  baseParams: BaseParams | null,
): FactorResponseMatrix[] {
  const fs = asArray<SpecialDemandFactor>(factors).filter((f) => f != null);
  const gs = asArray<GroupRow>(groups).filter((g) => g != null);
  const dm: Map<string, DecisionRow> = decisionMap instanceof Map ? decisionMap : new Map();
  return fs.map((factor) => {
    const evaluations = gs.map((g) => ({
      group: g,
      result: evaluateGroupResponse(factor, week, dm.get(g.id)?.payload, baseParams),
    }));
    const values = evaluations
      .map((e) => e.result.metric_value)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const p25 = percentile(values, 0.25);
    const p75 = percentile(values, 0.75);

    const rows: GroupResponseRow[] = evaluations.map(({ group, result }) => ({
      group_id: group.id,
      group_name: group.name,
      class_label: group.class_label,
      status: result.status,
      metric_value: result.metric_value,
      compare: compareOf(result.metric_value, values.length, p25, p75),
      detail: result.detail,
    }));

    return {
      factor,
      trigger_text: describeTrigger(factor),
      rows,
      responded_count: rows.filter((r) => r.status === 'responded').length,
      total_groups: gs.length,
      median: percentile(values, 0.5),
    };
  });
}
