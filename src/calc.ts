import type {
  BaseParams,
  ChannelKey,
  ChannelMeta,
  ChannelResult,
  ChannelSimConfig,
  ChannelSimParams,
  CycleResult,
  DecisionPayload,
  RoomTypeDecision,
  RoomTypeKey,
  RoomTypeMeta,
  RoomTypeResult,
  WeekDecision,
  WeekResult,
} from './types';
import {
  CHANNEL_MAP,
  DEFAULT_CHANNEL_SIM,
  SPECIAL_FACTOR_MAP,
  WEEK_MAP,
  WEEKS,
  emptyChannelDecision,
  emptyWeekDecision,
  priceMax,
  priceMin,
  resolveChannelSim,
  resolveChannelSimParams,
  resolveChannels,
  resolveRoomTypes,
  resolveTotalRooms,
} from './domain';

// A saved payload may legitimately be partial: save_week merges one week at a
// time, so a group that only saved drafts for wk2/wk3 has a payload with just
// those weeks. Every reader below must tolerate missing weeks/channels/room
// types instead of crashing the whole screen.
function fallbackRoomTypeDecision() {
  return {
    price: null,
    quota: null,
    weekend_pricing_enabled: false,
    weekend_days: [] as number[],
    weekday_price: null,
    weekend_price: null,
    weekday_quota: null,
    weekend_quota: null,
  };
}

function factorMultiplier(specialFactors?: string[] | null): number {
  let m = 1;
  for (const key of specialFactors ?? []) {
    const f = SPECIAL_FACTOR_MAP[key];
    if (f) m *= f.demandMultiplier;
  }
  return m;
}

function hasActiveSpecialFactors(specialFactors?: string[] | null): boolean {
  return (specialFactors ?? []).some((key) => {
    const f = SPECIAL_FACTOR_MAP[key];
    return f && f.demandMultiplier !== 1;
  });
}

/**
 * Seeded pseudo-random generator (mulberry32).
 * Deterministic from weekKey + groupId for reproducible viral events.
 */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface DaySplit {
  weekdayDays: number;
  weekendDays: number;
}

function countWeekdayWeekendDays(weekKey: string, weekendDaySet: Set<number>): DaySplit {
  const week = WEEK_MAP[weekKey];
  if (!week) return { weekdayDays: 7, weekendDays: 0 };
  const startDate = new Date(week.startDate);
  const totalDays = week.days;
  let weekend = 0;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const jsDow = d.getDay();
    const dow = jsDow === 0 ? 7 : jsDow;
    if (weekendDaySet.has(dow)) weekend++;
  }
  return {
    weekdayDays: totalDays - weekend,
    weekendDays: weekend,
  };
}

/**
 * M6: Price competitiveness multiplier.
 * Pricing above market anchor (base ADR) decreases conversion;
 * below increases it but hurts RevPAR.
 */
function priceCompetitiveness(
  price: number,
  basePrice: number,
  sensitivity: number,
): number {
  if (basePrice <= 0) return 1;
  const ratio = price / basePrice;
  if (ratio <= 1) return Math.min(1.6, 1 + (1 - ratio) * sensitivity);
  if (ratio <= 1.3) return Math.max(0.3, 1 - (ratio - 1) * sensitivity * 1.4);
  if (ratio <= 1.6) return Math.max(0.15, 1 - (ratio - 1) * sensitivity * 1.8);
  return Math.max(0.05, 1 - (ratio - 1) * sensitivity * 2.2);
}

interface PendingEntry {
  channelKey: string;
  roomTypeKey: string;
  amount: number;
  price: number;
  remainingRate: number;
  releaseOffset: number;
}

interface WeekSimContext {
  weekIndex: number;
  weekKey: string;
  groupId: string;
  simConfig: ChannelSimConfig;
  totalRoomsPerDay: number;
  channels: ChannelMeta[];
  roomTypes: RoomTypeMeta[];
}

/**
 * Compute per-channel-per-room-type theoretical transactions for a week,
 * then apply traffic caps, conversion rates, price competitiveness, and
 * viral randomness. Returns the raw transaction data before long-tail splitting.
 */
interface RawTransaction {
  channelKey: string;
  channelName: string;
  roomTypeKey: string;
  roomTypeName: string;
  allocatedQuota: number;
  avgPrice: number;
  basePrice: number;
  theoreticalRn: number;
  cappedRn: number;
  conversionRate: number;
  trafficCapRn: number;
  impressions: number;
  clickRate: number;
  isViral: boolean;
  contentCost: number;
}

function computeWeekTransactions(
  ctx: WeekSimContext,
  weekDecision: WeekDecision,
): RawTransaction[] {
  const { weekIndex, weekKey, groupId, simConfig, totalRoomsPerDay, channels, roomTypes } = ctx;
  const week = WEEK_MAP[weekKey];
  const days = week.days;
  const totalRoomSupply = totalRoomsPerDay * days;
  const multiplier = factorMultiplier(weekDecision?.specialFactors);
  const rng = seededRng(hashStr(weekKey + groupId));

  const results: RawTransaction[] = [];

  for (const channel of channels) {
    const channelDec = weekDecision?.channels?.[channel.key] ?? emptyChannelDecision(roomTypes);
    const simParams = resolveChannelSimParams(channel.key, simConfig);

    // Per-room-type split quotas: in weekend-pricing mode the weekday and
    // weekend quotas each apply to their own days, so the week's allocated
    // room-nights are day-weighted (weekday_quota × 工作日天数 + weekend_quota × 周末天数).
    const splits = roomTypes.map((roomType) => {
      const rtDec = channelDec.roomTypes[roomType.key] ?? fallbackRoomTypeDecision();
      const weekendActive =
        rtDec.weekend_pricing_enabled === true &&
        Array.isArray(rtDec.weekend_days) &&
        rtDec.weekend_days.length > 0;
      const wdQ = (weekendActive ? rtDec.weekday_quota ?? rtDec.quota : rtDec.quota) ?? 0;
      const weQ = (weekendActive ? rtDec.weekend_quota ?? rtDec.quota : rtDec.quota) ?? 0;
      const { weekdayDays, weekendDays } = weekendActive
        ? countWeekdayWeekendDays(weekKey, new Set(rtDec.weekend_days ?? []))
        : { weekdayDays: days, weekendDays: 0 };
      const allocatedRn = wdQ * weekdayDays + weQ * weekendDays;

      // Average price across the week (handling weekend pricing)
      let avgPrice = rtDec.price ?? 0;
      if (
        weekendActive &&
        rtDec.weekday_price != null &&
        rtDec.weekend_price != null
      ) {
        avgPrice =
          (rtDec.weekday_price * weekdayDays + rtDec.weekend_price * weekendDays) / days;
      }

      return { roomType, rtDec, allocatedRn, avgPrice };
    });

    // Per-day channel quota, used for content/ad cost scaling.
    const totalChannelQuota = splits.reduce((s, x) => s + x.allocatedRn, 0) / days;

    // Determine viral status for this channel this week
    const viralRoll = rng();
    const isViral = viralRoll < simParams.viralProbability;

    // Cold-start discount for content channels
    const coldStartFactor =
      weekIndex < simParams.coldStartWeeks ? simParams.coldStartDiscount : 1.0;

    // Traffic cap in room nights for this channel this week
    const effectiveCapRate = isViral
      ? simParams.trafficCap + simParams.viralCapRelax
      : simParams.trafficCap;
    const trafficCapRn = totalRoomSupply * effectiveCapRate;

    // Content/ad cost: fixed weekly + per allocated room night
    const contentCost =
      simParams.weeklyFixedCost + totalChannelQuota * simParams.perRoomNightCost;

    for (const { roomType, rtDec, allocatedRn, avgPrice } of splits) {
      const rtBasePrice = channel.basePrice * roomType.priceMultiplier;

      if (allocatedRn <= 0 || avgPrice <= 0) {
        results.push({
          channelKey: channel.key,
          channelName: channel.name,
          roomTypeKey: roomType.key,
          roomTypeName: roomType.name,
          allocatedQuota: allocatedRn,
          avgPrice: 0,
          basePrice: rtBasePrice,
          theoreticalRn: 0,
          cappedRn: 0,
          conversionRate: simParams.baseConversionRate,
          trafficCapRn,
          impressions: 0,
          clickRate: simParams.baseClickRate,
          isViral: false,
          contentCost: 0,
        });
        continue;
      }

      // M6: Price competitiveness
      const priceComp = priceCompetitiveness(avgPrice, rtBasePrice, simConfig.priceSensitivity);

      // M1: Base conversion rate × price competitiveness × demand environment
      let conversionRate = simParams.baseConversionRate * priceComp * multiplier * coldStartFactor;

      // M5: Viral multiplier
      if (isViral) {
        conversionRate *= simParams.viralMultiplier;
      }
      conversionRate = Math.min(conversionRate, 1.0);

      // Theoretical transactions = allocated × conversion rate
      const theoreticalRn = allocatedRn * conversionRate;

      // M2: Traffic cap — excess doesn't transact
      // We need to apportion the channel-level cap across room types
      const channelQuotaRn = totalChannelQuota * days;
      const capPortion = channelQuotaRn > 0 ? allocatedRn / channelQuotaRn : 0;
      const rtCapRn = trafficCapRn * capPortion;
      const cappedRn = Math.min(theoreticalRn, rtCapRn);

      // M7: Impressions and click rate (for visualization)
      const impressions = Math.round(allocatedRn * simParams.impressionMultiplier * (isViral ? 3 : 1));
      const clickRate = simParams.baseClickRate * (isViral ? 2 : 1) * priceComp;

      results.push({
        channelKey: channel.key,
        channelName: channel.name,
        roomTypeKey: roomType.key,
        roomTypeName: roomType.name,
        allocatedQuota: allocatedRn,
        avgPrice,
        basePrice: rtBasePrice,
        theoreticalRn,
        cappedRn,
        conversionRate,
        trafficCapRn,
        impressions,
        clickRate,
        isViral,
        contentCost,
      });
    }
  }

  return results;
}

function computeWeekResult(
  weekIndex: number,
  weekKey: string,
  weekDecision: WeekDecision,
  channels: ChannelMeta[],
  roomTypes: RoomTypeMeta[],
  totalRoomsPerDay: number,
  simConfig: ChannelSimConfig,
  groupId: string,
  pendingPool: PendingEntry[],
): { weekResult: WeekResult; newPending: PendingEntry[] } {
  const week = WEEK_MAP[weekKey];
  const days = week.days;
  const totalRooms = totalRoomsPerDay * days;

  const ctx: WeekSimContext = {
    weekIndex,
    weekKey,
    groupId,
    simConfig,
    totalRoomsPerDay,
    channels,
    roomTypes,
  };

  const rawTxns = computeWeekTransactions(ctx, weekDecision);

  // Group by channel for aggregation
  const channelMap = new Map<string, RawTransaction[]>();
  for (const t of rawTxns) {
    if (!channelMap.has(t.channelKey)) channelMap.set(t.channelKey, []);
    channelMap.get(t.channelKey)!.push(t);
  }

  // Process pending pool releases for this week
  let pendingCarriedOver: PendingEntry[] = [];
  const releasedByChannel = new Map<string, number>();

  for (const entry of pendingPool) {
    if (entry.releaseOffset <= 0) {
      // This entry is due for release this week
      const simParams = resolveChannelSimParams(entry.channelKey, simConfig);
      const totalChannelQuota = weekDecision?.channels?.[entry.channelKey]
        ? roomTypes.reduce(
            (s, rt) =>
              s +
              effectiveCellRoomNights(
                weekDecision.channels[entry.channelKey]?.roomTypes?.[rt.key],
                weekKey,
                days,
              ),
            0,
          )
        : 0;
      const capPortion = totalChannelQuota > 0 ? 1 / channels.length : 0;
      // Simplified: pending releases still subject to traffic cap
      const trafficCapRn = totalRooms * (simParams.trafficCap + simParams.viralCapRelax);
      const released = Math.min(entry.amount * entry.remainingRate, trafficCapRn * 0.1);
      releasedByChannel.set(
        entry.channelKey,
        (releasedByChannel.get(entry.channelKey) ?? 0) + released,
      );
    } else {
      // Not yet due, carry forward with decremented offset
      pendingCarriedOver.push({ ...entry, releaseOffset: entry.releaseOffset - 1 });
    }
  }

  const channelResults: ChannelResult[] = [];
  const newPending: PendingEntry[] = [...pendingCarriedOver];

  for (const channel of channels) {
    const txns = channelMap.get(channel.key) ?? [];
    const simParams = resolveChannelSimParams(channel.key, simConfig);
    const roomTypeResults: RoomTypeResult[] = [];
    let chAllocatedQuota = 0;
    let chImpressions = 0;
    let chConfirmedRn = 0;
    let chPendingRn = 0;
    let chGross = 0;
    let chCommission = 0;
    let chContentCost = 0;
    let chClickRate = 0;
    let chConversionRate = 0;
    let chTheoreticalRn = 0;
    let chCappedRn = 0;
    let quotaExceedsCap = false;

    for (const rt of roomTypes) {
      const t = txns.find((x) => x.roomTypeKey === rt.key);
      if (!t) {
        roomTypeResults.push({
          roomTypeKey: rt.key,
          roomTypeName: rt.name,
          roomNights: 0,
          adr: 0,
          grossRevenue: 0,
          commission: 0,
          netRevenue: 0,
        });
        continue;
      }

      chAllocatedQuota += t.allocatedQuota;
      chImpressions += t.impressions;
      chTheoreticalRn += t.theoreticalRn;
      chCappedRn += t.cappedRn;
      chClickRate += t.clickRate;
      chConversionRate += t.conversionRate;

      if (t.allocatedQuota > t.trafficCapRn * (txns.length > 0 ? 1 : 1)) {
        quotaExceedsCap = true;
      }

      // M3: Current-week confirmation vs long-tail pending
      const confirmRate = simParams.currentWeekConfirmRate;
      const confirmedRn = t.cappedRn * confirmRate;
      const unconfirmedRn = t.cappedRn - confirmedRn;

      // Add pending releases for this channel-roomType (proportional)
      const releasedRn = (releasedByChannel.get(channel.key) ?? 0) / (txns.length || 1);

      const totalRn = Math.round(confirmedRn + releasedRn);
      const grossRevenue = totalRn * t.avgPrice;
      const commission = grossRevenue * channel.commissionRate;
      const netRevenue = grossRevenue - commission;

      chConfirmedRn += totalRn;
      chGross += grossRevenue;
      chCommission += commission;
      chContentCost += t.contentCost / (txns.length || 1);

      // M3: Create pending entries for unconfirmed amount
      if (unconfirmedRn > 0.5 && simParams.longTailReleases.length > 0) {
        for (const release of simParams.longTailReleases) {
          newPending.push({
            channelKey: channel.key,
            roomTypeKey: rt.key,
            amount: unconfirmedRn,
            price: t.avgPrice,
            remainingRate: release.rate,
            releaseOffset: release.offset,
          });
        }
        chPendingRn += unconfirmedRn;
      }

      roomTypeResults.push({
        roomTypeKey: rt.key,
        roomTypeName: rt.name,
        roomNights: totalRn,
        adr: t.avgPrice,
        grossRevenue,
        commission,
        netRevenue,
      });
    }

    const chNet = chGross - chCommission;
    const totalCost = chCommission + chContentCost;
    const netContribution = chGross - totalCost;

    channelResults.push({
      channelKey: channel.key,
      channelName: channel.name,
      roomTypes: roomTypeResults,
      roomNights: chConfirmedRn,
      grossRevenue: chGross,
      commission: chCommission,
      netRevenue: chNet,
      allocatedQuota: Math.round(chAllocatedQuota),
      impressions: chImpressions,
      clickRate: txns.length > 0 ? chClickRate / txns.length : 0,
      conversionRate: txns.length > 0 ? chConversionRate / txns.length : 0,
      confirmedRoomNights: Math.round(chConfirmedRn),
      pendingRoomNights: Math.round(chPendingRn),
      contentCost: chContentCost,
      totalCost,
      netContribution,
      quotaExceedsCap,
      isViral: txns.some((t) => t.isViral),
    });
  }

  // aggregate per room type across channels
  const roomTypeResults: RoomTypeResult[] = roomTypes.map((rt) => {
    const items = channelResults.map((c) =>
      c.roomTypes.find((r) => r.roomTypeKey === rt.key)!,
    );
    return {
      roomTypeKey: rt.key,
      roomTypeName: rt.name,
      roomNights: items.reduce((s, r) => s + r.roomNights, 0),
      adr: 0,
      grossRevenue: items.reduce((s, r) => s + r.grossRevenue, 0),
      commission: items.reduce((s, r) => s + r.commission, 0),
      netRevenue: items.reduce((s, r) => s + r.netRevenue, 0),
    };
  });

  const totalRoomNights = channelResults.reduce((s, c) => s + c.roomNights, 0);
  const grossRevenue = channelResults.reduce((s, c) => s + c.grossRevenue, 0);
  const totalCommission = channelResults.reduce((s, c) => s + c.commission, 0);
  const totalContentCost = channelResults.reduce((s, c) => s + c.contentCost, 0);
  const totalNetContribution = channelResults.reduce((s, c) => s + c.netContribution, 0);
  const netRevenue = grossRevenue - totalCommission;
  const occupancy = totalRooms > 0 ? totalRoomNights / totalRooms : 0;
  const revpar = totalRooms > 0 ? netRevenue / totalRooms : 0;

  const weekResult: WeekResult = {
    weekKey,
    weekLabel: week.label,
    days,
    channels: channelResults,
    roomTypes: roomTypeResults,
    totalRoomNights,
    occupancy,
    revpar,
    grossRevenue,
    totalCommission,
    netRevenue,
    totalContentCost,
    totalNetContribution,
  };

  return { weekResult, newPending };
}

export function computeCycle(
  payload: DecisionPayload,
  overrides?: BaseParams | null,
  simConfig?: ChannelSimConfig | null,
  groupId?: string,
): CycleResult {
  const channels = resolveChannels(overrides);
  const roomTypes = resolveRoomTypes(overrides);
  const totalRoomsPerDay = resolveTotalRooms(overrides);
  const resolvedSim = resolveChannelSim(simConfig);
  const gid = groupId ?? 'default';

  let pendingPool: PendingEntry[] = [];
  const weekResults: WeekResult[] = [];

  for (let i = 0; i < WEEKS.length; i++) {
    const w = WEEKS[i];
    const { weekResult, newPending } = computeWeekResult(
      i,
      w.key,
      payload.weeks[w.key] ?? emptyWeekDecision(channels, roomTypes),
      channels,
      roomTypes,
      totalRoomsPerDay,
      resolvedSim,
      gid,
      pendingPool,
    );
    weekResults.push(weekResult);
    pendingPool = newPending;
  }

  const totalRoomNights = weekResults.reduce((s, w) => s + w.totalRoomNights, 0);
  const totalRoomNightsAvailable = weekResults.reduce(
    (s, w) => s + w.days * totalRoomsPerDay,
    0,
  );
  const totalGrossRevenue = weekResults.reduce((s, w) => s + w.grossRevenue, 0);
  const totalCommission = weekResults.reduce((s, w) => s + w.totalCommission, 0);
  const totalContentCost = weekResults.reduce((s, w) => s + w.totalContentCost, 0);
  const totalNetContribution = weekResults.reduce(
    (s, w) => s + w.totalNetContribution,
    0,
  );
  const totalNetRevenue = totalGrossRevenue - totalCommission;
  const overallOccupancy =
    totalRoomNightsAvailable > 0 ? totalRoomNights / totalRoomNightsAvailable : 0;
  const overallRevpar =
    totalRoomNightsAvailable > 0 ? totalNetRevenue / totalRoomNightsAvailable : 0;

  // Potential long-tail value from unconfirmed pending at sandbox end
  const potentialLongTailValue = pendingPool.reduce((s, e) => {
    const simParams = resolveChannelSimParams(e.channelKey, resolvedSim);
    return s + e.amount * e.remainingRate * e.price;
  }, 0);

  return {
    weeks: weekResults,
    totalRoomNights,
    totalRoomNightsAvailable,
    overallOccupancy,
    overallRevpar,
    totalGrossRevenue,
    totalCommission,
    totalNetRevenue,
    totalContentCost,
    totalNetContribution,
    potentialLongTailValue,
  };
}

/**
 * Effective split quotas for one channel x room type cell.
 *
 * In weekend-pricing mode the weekday and weekend quotas are filled separately
 * (weekday_quota / weekend_quota). Historical cells only carry the legacy
 * single `quota`, so both periods fall back to it — old submitted weeks keep
 * echoing correctly without any data migration.
 */
export function splitQuotas(rtDec: RoomTypeDecision | null | undefined): {
  weekday: number | null;
  weekend: number | null;
} {
  if (!rtDec) return { weekday: null, weekend: null };
  if (rtDec.weekend_pricing_enabled === true) {
    return {
      weekday: rtDec.weekday_quota ?? rtDec.quota ?? null,
      weekend: rtDec.weekend_quota ?? rtDec.quota ?? null,
    };
  }
  return { weekday: rtDec.quota ?? null, weekend: rtDec.quota ?? null };
}

/**
 * Total room-nights one cell contributes across the week's days, honoring the
 * weekday/weekend quota split (each quota applies to its own days).
 */
export function effectiveCellRoomNights(
  rtDec: RoomTypeDecision | null | undefined,
  weekKey: string,
  days: number,
): number {
  if (!rtDec) return 0;
  const { weekday, weekend } = splitQuotas(rtDec);
  if (rtDec.weekend_pricing_enabled === true && Array.isArray(rtDec.weekend_days) && rtDec.weekend_days.length > 0) {
    const { weekdayDays, weekendDays } = countWeekdayWeekendDays(weekKey, new Set(rtDec.weekend_days));
    return (weekday ?? 0) * weekdayDays + (weekend ?? 0) * weekendDays;
  }
  return (weekday ?? 0) * days;
}

export function weekQuotaTotal(weekDecision: WeekDecision, overrides?: BaseParams | null): number {
  // 周末拆分配额下，工作日与周末各自受房量约束；对外展示与校验取两者较大值。
  const { weekday, weekend } = weekQuotaTotalsSplit(weekDecision, overrides);
  return Math.max(weekday, weekend);
}

export function weekQuotaTotalsSplit(
  weekDecision: WeekDecision,
  overrides?: BaseParams | null,
): { weekday: number; weekend: number } {
  let wdTotal = 0;
  let weTotal = 0;
  for (const c of resolveChannels(overrides)) {
    const ch = weekDecision?.channels?.[c.key];
    for (const rt of resolveRoomTypes(overrides)) {
      const { weekday, weekend } = splitQuotas(ch?.roomTypes?.[rt.key]);
      wdTotal += weekday ?? 0;
      weTotal += weekend ?? 0;
    }
  }
  return { weekday: wdTotal, weekend: weTotal };
}

export function roomTypeQuotaTotal(
  weekDecision: WeekDecision,
  roomTypeKey: RoomTypeKey,
  overrides?: BaseParams | null,
): number {
  const { weekday, weekend } = roomTypeQuotaTotalsSplit(weekDecision, roomTypeKey, overrides);
  return Math.max(weekday, weekend);
}

export function roomTypeQuotaTotalsSplit(
  weekDecision: WeekDecision,
  roomTypeKey: RoomTypeKey,
  overrides?: BaseParams | null,
): { weekday: number; weekend: number } {
  let wdTotal = 0;
  let weTotal = 0;
  for (const c of resolveChannels(overrides)) {
    const { weekday, weekend } = splitQuotas(weekDecision?.channels?.[c.key]?.roomTypes?.[roomTypeKey]);
    wdTotal += weekday ?? 0;
    weTotal += weekend ?? 0;
  }
  return { weekday: wdTotal, weekend: weTotal };
}

// ─── 配额总览：配额总数 / 已用量 / 剩余量 / 配额状态 ─────────────────────────
// 数据来源：完全由前端已保存的决策 payload 本地计算（weekDecision.channels[*]
// .roomTypes[*].quota / weekday_quota / weekend_quota），不依赖任何新增后端字段，
// 接口层无需改动。房量上限取 app_settings.base_params（缺省用内置常量）。
export type QuotaStatus = 'blank' | 'empty' | 'partial' | 'full' | 'over';

const QUOTA_STATUS_SEVERITY: Record<QuotaStatus, number> = {
  blank: 0,
  full: 1,
  empty: 2,
  partial: 3,
  over: 4,
};

export interface QuotaPeriodUsage {
  /** null = 该周期所有渠道都未填写（空白），与“填了 0”区分开 */
  used: number | null;
  remaining: number | null;
  status: QuotaStatus;
}

export interface QuotaOverviewRow {
  key: string;
  name: string;
  /** 配额总数（该房型房量 / 酒店总房量） */
  cap: number;
  weekday: QuotaPeriodUsage;
  weekend: QuotaPeriodUsage;
  /** 是否需要在界面上分别展示工作日与周末（存在显式拆分配额时为 true） */
  split: boolean;
  filledCells: number;
  totalCells: number;
  status: QuotaStatus;
}

export interface QuotaOverview {
  rows: QuotaOverviewRow[];
  total: QuotaOverviewRow;
  hasWeekendSplit: boolean;
  allBlank: boolean;
}

function periodUsage(used: number | null, cap: number): QuotaPeriodUsage {
  if (used === null) return { used: null, remaining: null, status: 'blank' };
  const remaining = cap - used;
  const status: QuotaStatus =
    used > cap ? 'over' : used === cap ? 'full' : used === 0 ? 'empty' : 'partial';
  return { used, remaining, status };
}

function worstStatus(a: QuotaStatus, b: QuotaStatus): QuotaStatus {
  return QUOTA_STATUS_SEVERITY[a] >= QUOTA_STATUS_SEVERITY[b] ? a : b;
}

export function buildQuotaOverview(
  weekDecision: WeekDecision | null | undefined,
  overrides?: BaseParams | null,
): QuotaOverview {
  const channels = resolveChannels(overrides);
  const roomTypes = resolveRoomTypes(overrides);
  const totalRooms = resolveTotalRooms(overrides);

  const rows: QuotaOverviewRow[] = roomTypes.map((rt) => {
    let wdSum = 0;
    let weSum = 0;
    let wdMissing = 0;
    let weMissing = 0;
    let rowHasSplit = false;
    let filledCells = 0;

    for (const c of channels) {
      const cell = weekDecision?.channels?.[c.key]?.roomTypes?.[rt.key];
      const enabled = cell?.weekend_pricing_enabled === true;
      if (enabled && (cell?.weekday_quota != null || cell?.weekend_quota != null)) {
        rowHasSplit = true;
      }
      const { weekday, weekend } = splitQuotas(cell);
      if (weekday == null) wdMissing += 1;
      else wdSum += weekday;
      if (weekend == null) weMissing += 1;
      else weSum += weekend;
      if (weekday != null || weekend != null) filledCells += 1;
    }

    const wdAllMissing = wdMissing === channels.length;
    const weAllMissing = weMissing === channels.length;
    const weekday = periodUsage(wdAllMissing ? null : wdSum, rt.inventory);
    const weekend = periodUsage(weAllMissing ? null : weSum, rt.inventory);

    return {
      key: rt.key,
      name: rt.name,
      cap: rt.inventory,
      weekday,
      weekend,
      split: rowHasSplit,
      filledCells,
      totalCells: channels.length,
      status: worstStatus(weekday.status, weekend.status),
    };
  });

  const sumPeriod = (pick: (r: QuotaOverviewRow) => QuotaPeriodUsage, cap: number) => {
    const values = rows.map((r) => pick(r).used);
    if (values.every((v) => v === null)) {
      return { used: null as number | null, remaining: null as number | null, status: 'blank' as QuotaStatus };
    }
    const used = values.reduce<number>((s, v) => s + (v ?? 0), 0);
    return periodUsage(used, cap);
  };

  const total: QuotaOverviewRow = {
    key: '__total__',
    name: '酒店总配额',
    cap: totalRooms,
    weekday: sumPeriod((r) => r.weekday, totalRooms),
    weekend: sumPeriod((r) => r.weekend, totalRooms),
    split: rows.some((r) => r.split),
    filledCells: rows.reduce((s, r) => s + r.filledCells, 0),
    totalCells: rows.reduce((s, r) => s + r.totalCells, 0),
    status: 'blank',
  };
  total.status = worstStatus(total.weekday.status, total.weekend.status);

  return {
    rows,
    total,
    hasWeekendSplit: rows.some((r) => r.split),
    allBlank: total.filledCells === 0,
  };
}

export function priceError(
  channelKey: ChannelKey,
  roomTypeKey: RoomTypeKey,
  price: number | null,
  overrides?: BaseParams | null,
): string | null {
  if (price === null || price === undefined || Number.isNaN(price)) return null;
  if (price < 0) return '禁止输入负数';
  const min = priceMin(channelKey, roomTypeKey, overrides);
  const max = priceMax(channelKey, roomTypeKey, overrides);
  if (price < min) return `不得低于底价 ¥${min}`;
  if (price > max) return `不得高于门市价2倍 ¥${max}`;
  return null;
}

export function quotaError(quota: number | null, inventory?: number): string | null {
  if (quota === null || quota === undefined || Number.isNaN(quota)) return null;
  if (quota < 0) return '禁止输入负数';
  if (!Number.isInteger(quota)) return '配额需为整数';
  if (inventory != null && quota > inventory) {
    return `不得超过该房型房量 ${inventory} 间`;
  }
  return null;
}

/**
 * Submit-time quota rule (第 6 批修复).
 *
 * Historically `validateWeek` only required a quota to be *present* for the
 * field-level rules and never required it at all before batch 5 — a group could
 * submit a week whose prices were complete while every quota was empty, 0, or
 * out of range. Production evidence: 酒管25091 第6组 wk5 提交了 18 个价格，
 * 18 个配额全为 null，页面显示"总房量配额 0/100"。
 *
 * A quota is now only accepted when it is:
 *   1. present (not null / undefined / NaN),
 *   2. an integer >= 1 — 0 is rejected so "未投放" cannot masquerade as a
 *      filled decision,
 *   3. <= the room type's inventory.
 *
 * The same rule is enforced server-side by
 * `supabase/migrations/20261019100000_require_valid_quota_on_submit.sql`
 * (SQLSTATE 40013, raised before any write), so the button state in the UI is
 * never the only guard.
 */
export function quotaSubmissionError(quota: number | null | undefined, inventory: number): string | null {
  if (quota === null || quota === undefined || Number.isNaN(quota)) return '配额未填写';
  if (!Number.isFinite(quota) || !Number.isInteger(quota)) return '配额需为整数';
  if (quota <= 0) return '配额不能为 0 或负数';
  if (quota > inventory) return `不得超过该房型房量 ${inventory} 间`;
  return null;
}

/**
 * A week is "blank" when no channel × room type cell carries either a price or
 * a quota. The weekly exercise IS the pricing/quota decision, so a blank week
 * means the student did no work that week.
 *
 * Drafts may still be blank (auto-save keeps partial work); only submission is
 * gated on completeness.
 */
export function isWeekBlank(
  weekDecision: WeekDecision | null | undefined,
  overrides?: BaseParams | null,
): boolean {
  if (!weekDecision) return true;
  const channels = resolveChannels(overrides);
  const roomTypes = resolveRoomTypes(overrides);
  for (const ch of channels) {
    const cd = weekDecision.channels?.[ch.key];
    if (!cd) continue;
    for (const rt of roomTypes) {
      const rtDec = cd.roomTypes?.[rt.key];
      if (!rtDec) continue;
      const quotaFilled =
        rtDec.quota !== null && rtDec.quota !== undefined
        || rtDec.weekday_quota !== null && rtDec.weekday_quota !== undefined
        || rtDec.weekend_quota !== null && rtDec.weekend_quota !== undefined;
      const priceFilled =
        rtDec.weekend_pricing_enabled === true
          ? rtDec.weekday_price != null || rtDec.weekend_price != null
          : rtDec.price != null;
      if (quotaFilled || priceFilled) return false;
    }
  }
  return true;
}

export function validateWeek(payload: DecisionPayload, weekKey: string, overrides?: BaseParams | null): string[] {
  const errors: string[] = [];
  const week = WEEKS.find((w) => w.key === weekKey);
  if (!week) return errors;
  const wd = payload.weeks[weekKey];
  if (!wd) return errors;

  const channels = resolveChannels(overrides);
  const roomTypes = resolveRoomTypes(overrides);
  const totalRooms = resolveTotalRooms(overrides);

  const qTotals = weekQuotaTotalsSplit(wd, overrides);
  if (qTotals.weekday > totalRooms) {
    errors.push(
      `各渠道工作日配额之和 ${qTotals.weekday} 间超过总房量 ${totalRooms} 间`,
    );
  }
  if (qTotals.weekend > totalRooms) {
    errors.push(
      `各渠道周末配额之和 ${qTotals.weekend} 间超过总房量 ${totalRooms} 间`,
    );
  }
  for (const rt of roomTypes) {
    const rtTotals = roomTypeQuotaTotalsSplit(wd, rt.key, overrides);
    if (rtTotals.weekday > rt.inventory) {
      errors.push(
        `${rt.name}：各渠道工作日配额之和 ${rtTotals.weekday} 间超过该房型房量 ${rt.inventory} 间`,
      );
    }
    if (rtTotals.weekend > rt.inventory) {
      errors.push(
        `${rt.name}：各渠道周末配额之和 ${rtTotals.weekend} 间超过该房型房量 ${rt.inventory} 间`,
      );
    }
  }
  // Submission requires a fully filled week: every channel × room type must
  // carry both a price and a quota. A blank week collapses to a single clear
  // message instead of dozens of duplicated field errors.
  if (isWeekBlank(wd, overrides)) {
    return ['本周尚未填写任何内容：请完成每个渠道 × 房型的价格与配额后再提交'];
  }

  for (const ch of channels) {
    const cd = wd.channels?.[ch.key];
    for (const rt of roomTypes) {
      const rtDec = cd?.roomTypes?.[rt.key];
      if (!rtDec) {
        errors.push(`${ch.name}-${rt.name}：尚未填写价格与配额`);
        continue;
      }
      if (rtDec.weekend_pricing_enabled === true) {
        const weekendDays = rtDec.weekend_days ?? [];
        if (weekendDays.length === 0) {
          errors.push(`${ch.name}-${rt.name}：开启周末价后至少勾选1个星期`);
        } else if (weekendDays.length === 7) {
          errors.push(`${ch.name}-${rt.name}：不能将全部7天都设为周末价`);
        }
        if (rtDec.weekday_price == null) {
          errors.push(`${ch.name}-${rt.name}：工作日价未填写`);
        } else {
          const wdpErr = priceError(ch.key, rt.key, rtDec.weekday_price, overrides);
          if (wdpErr) errors.push(`${ch.name}-${rt.name}工作日价：${wdpErr}`);
        }
        if (rtDec.weekend_price == null) {
          errors.push(`${ch.name}-${rt.name}：周末价未填写`);
        } else {
          const wepErr = priceError(ch.key, rt.key, rtDec.weekend_price, overrides);
          if (wepErr) errors.push(`${ch.name}-${rt.name}周末价：${wepErr}`);
        }
      } else if (rtDec.price == null) {
        errors.push(`${ch.name}-${rt.name}：价格未填写`);
      } else {
        const pErr = priceError(ch.key, rt.key, rtDec.price, overrides);
        if (pErr) errors.push(`${ch.name}-${rt.name}：${pErr}`);
      }
      // Quota is a required decision, validated at the same stage as the price:
      // missing, 0/negative, non-integer and out-of-range values all block the
      // submission. Mirrors the server-side rule in migration 20261019100000.
      if (rtDec.weekend_pricing_enabled === true) {
        // 周末价模式：工作日与周末配额分别必填（历史数据回退到单一 quota）。
        const wdQ = rtDec.weekday_quota ?? rtDec.quota;
        const weQ = rtDec.weekend_quota ?? rtDec.quota;
        const wdQErr = quotaSubmissionError(wdQ, rt.inventory);
        if (wdQErr) errors.push(`${ch.name}-${rt.name}工作日配额：${wdQErr}`);
        const weQErr = quotaSubmissionError(weQ, rt.inventory);
        if (weQErr) errors.push(`${ch.name}-${rt.name}周末配额：${weQErr}`);
      } else {
        const qErr = quotaSubmissionError(rtDec.quota, rt.inventory);
        if (qErr) errors.push(`${ch.name}-${rt.name}：${qErr}`);
      }
    }
  }
  return errors;
}

export function validateAll(payload: DecisionPayload, overrides?: BaseParams | null): string[] {
  const errors: string[] = [];
  const channels = resolveChannels(overrides);
  const roomTypes = resolveRoomTypes(overrides);
  const totalRooms = resolveTotalRooms(overrides);
  for (const week of WEEKS) {
    const wd = payload.weeks[week.key];
    if (!wd) continue;
    const qTotals = weekQuotaTotalsSplit(wd, overrides);
    if (qTotals.weekday > totalRooms) {
      errors.push(
        `第${week.index}周 (${week.label})：各渠道工作日配额之和 ${qTotals.weekday} 间超过总房量 ${totalRooms} 间`,
      );
    }
    if (qTotals.weekend > totalRooms) {
      errors.push(
        `第${week.index}周 (${week.label})：各渠道周末配额之和 ${qTotals.weekend} 间超过总房量 ${totalRooms} 间`,
      );
    }
    for (const rt of roomTypes) {
      const rtTotals = roomTypeQuotaTotalsSplit(wd, rt.key, overrides);
      if (rtTotals.weekday > rt.inventory) {
        errors.push(
          `第${week.index}周 · ${rt.name}：各渠道工作日配额之和 ${rtTotals.weekday} 间超过该房型房量 ${rt.inventory} 间`,
        );
      }
      if (rtTotals.weekend > rt.inventory) {
        errors.push(
          `第${week.index}周 · ${rt.name}：各渠道周末配额之和 ${rtTotals.weekend} 间超过该房型房量 ${rt.inventory} 间`,
        );
      }
    }
    for (const ch of channels) {
      const cd = wd.channels[ch.key];
      for (const rt of roomTypes) {
        const rtDec = cd.roomTypes[rt.key];
        if (rtDec.weekend_pricing_enabled === true) {
          const weekendDays = rtDec.weekend_days ?? [];
          if (weekendDays.length === 0) {
            errors.push(`第${week.index}周 · ${ch.name}-${rt.name}：开启周末价后至少勾选1个星期`);
          } else if (weekendDays.length === 7) {
            errors.push(`第${week.index}周 · ${ch.name}-${rt.name}：不能将全部7天都设为周末价`);
          }
          const wdpErr = priceError(ch.key, rt.key, rtDec.weekday_price ?? null, overrides);
          if (wdpErr) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}工作日价：${wdpErr}`);
          if (rtDec.weekday_price == null) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}：工作日价不能为空`);
          const wepErr = priceError(ch.key, rt.key, rtDec.weekend_price ?? null, overrides);
          if (wepErr) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}周末价：${wepErr}`);
          if (rtDec.weekend_price == null) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}：周末价不能为空`);
        } else {
          const pErr = priceError(ch.key, rt.key, rtDec.price, overrides);
          if (pErr) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}：${pErr}`);
        }
        if (rtDec.weekend_pricing_enabled === true) {
          const wdQ = rtDec.weekday_quota ?? rtDec.quota;
          const weQ = rtDec.weekend_quota ?? rtDec.quota;
          const wdQErr = quotaSubmissionError(wdQ, rt.inventory);
          if (wdQErr) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}工作日配额：${wdQErr}`);
          const weQErr = quotaSubmissionError(weQ, rt.inventory);
          if (weQErr) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}周末配额：${weQErr}`);
        } else {
          const qErr = quotaSubmissionError(rtDec.quota, rt.inventory);
          if (qErr) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}：${qErr}`);
        }
      }
    }
  }
  return errors;
}

export { CHANNEL_MAP };

export { hasActiveSpecialFactors };

export { DEFAULT_CHANNEL_SIM };
