import type {
  BaseParams,
  ChannelKey,
  ChannelMeta,
  ChannelResult,
  ChannelSimConfig,
  ChannelSimParams,
  CycleResult,
  DecisionPayload,
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
  priceMax,
  priceMin,
  resolveChannelSim,
  resolveChannelSimParams,
  resolveChannels,
  resolveRoomTypes,
  resolveTotalRooms,
} from './domain';

function factorMultiplier(specialFactors: string[]): number {
  let m = 1;
  for (const key of specialFactors) {
    const f = SPECIAL_FACTOR_MAP[key];
    if (f) m *= f.demandMultiplier;
  }
  return m;
}

function hasActiveSpecialFactors(specialFactors: string[]): boolean {
  return specialFactors.some((key) => {
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
  const multiplier = factorMultiplier(weekDecision.specialFactors);
  const rng = seededRng(hashStr(weekKey + groupId));

  const results: RawTransaction[] = [];

  for (const channel of channels) {
    const channelDec = weekDecision.channels[channel.key];
    const simParams = resolveChannelSimParams(channel.key, simConfig);
    const totalChannelQuota = roomTypes.reduce(
      (s, rt) => s + (channelDec.roomTypes[rt.key].quota ?? 0),
      0,
    );

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

    for (const roomType of roomTypes) {
      const rtDec = channelDec.roomTypes[roomType.key];
      const quota = rtDec.quota ?? 0;
      const rtBasePrice = channel.basePrice * roomType.priceMultiplier;

      // Calculate average price (handling weekend pricing)
      let avgPrice = rtDec.price ?? 0;
      if (
        rtDec.weekend_pricing_enabled === true &&
        rtDec.weekday_price != null &&
        rtDec.weekend_price != null &&
        Array.isArray(rtDec.weekend_days) &&
        rtDec.weekend_days.length > 0
      ) {
        const weekendSet = new Set(rtDec.weekend_days);
        const { weekdayDays, weekendDays } = countWeekdayWeekendDays(weekKey, weekendSet);
        const wdPrice = rtDec.weekday_price;
        const wePrice = rtDec.weekend_price;
        avgPrice = (wdPrice * weekdayDays + wePrice * weekendDays) / days;
      }

      if (quota <= 0 || avgPrice <= 0) {
        results.push({
          channelKey: channel.key,
          channelName: channel.name,
          roomTypeKey: roomType.key,
          roomTypeName: roomType.name,
          allocatedQuota: quota * days,
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

      const allocatedRn = quota * days;

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
      const totalChannelQuota = weekDecision.channels[entry.channelKey]
        ? roomTypes.reduce(
            (s, rt) => s + (weekDecision.channels[entry.channelKey].roomTypes[rt.key].quota ?? 0),
            0,
          ) * days
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
      payload.weeks[w.key],
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

export function weekQuotaTotal(weekDecision: WeekDecision, overrides?: BaseParams | null): number {
  return resolveChannels(overrides).reduce((sum, c) => {
    const ch = weekDecision.channels[c.key];
    return (
      sum +
      resolveRoomTypes(overrides).reduce(
        (s, rt) => s + (ch.roomTypes[rt.key].quota ?? 0),
        0,
      )
    );
  }, 0);
}

export function roomTypeQuotaTotal(
  weekDecision: WeekDecision,
  roomTypeKey: RoomTypeKey,
  overrides?: BaseParams | null,
): number {
  return resolveChannels(overrides).reduce((sum, c) => {
    const ch = weekDecision.channels[c.key];
    return sum + (ch.roomTypes[roomTypeKey].quota ?? 0);
  }, 0);
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

export function quotaError(quota: number | null): string | null {
  if (quota === null || quota === undefined || Number.isNaN(quota)) return null;
  if (quota < 0) return '禁止输入负数';
  if (!Number.isInteger(quota)) return '配额需为整数';
  return null;
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

  const qTotal = weekQuotaTotal(wd, overrides);
  if (qTotal > totalRooms) {
    errors.push(
      `各渠道配额之和 ${qTotal} 间超过总房量 ${totalRooms} 间`,
    );
  }
  for (const rt of roomTypes) {
    const rtTotal = roomTypeQuotaTotal(wd, rt.key, overrides);
    if (rtTotal > rt.inventory) {
      errors.push(
        `${rt.name}：各渠道配额之和 ${rtTotal} 间超过该房型房量 ${rt.inventory} 间`,
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
          errors.push(`${ch.name}-${rt.name}：开启周末价后至少勾选1个星期`);
        } else if (weekendDays.length === 7) {
          errors.push(`${ch.name}-${rt.name}：不能将全部7天都设为周末价`);
        }
        const wdpErr = priceError(ch.key, rt.key, rtDec.weekday_price ?? null, overrides);
        if (wdpErr) errors.push(`${ch.name}-${rt.name}工作日价：${wdpErr}`);
        if (rtDec.weekday_price == null) errors.push(`${ch.name}-${rt.name}：工作日价不能为空`);
        const wepErr = priceError(ch.key, rt.key, rtDec.weekend_price ?? null, overrides);
        if (wepErr) errors.push(`${ch.name}-${rt.name}周末价：${wepErr}`);
        if (rtDec.weekend_price == null) errors.push(`${ch.name}-${rt.name}：周末价不能为空`);
      } else {
        const pErr = priceError(ch.key, rt.key, rtDec.price, overrides);
        if (pErr) errors.push(`${ch.name}-${rt.name}：${pErr}`);
      }
      const qErr = quotaError(rtDec.quota);
      if (qErr) errors.push(`${ch.name}-${rt.name}：${qErr}`);
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
    const qTotal = weekQuotaTotal(wd, overrides);
    if (qTotal > totalRooms) {
      errors.push(
        `第${week.index}周 (${week.label})：各渠道配额之和 ${qTotal} 间超过总房量 ${totalRooms} 间`,
      );
    }
    for (const rt of roomTypes) {
      const rtTotal = roomTypeQuotaTotal(wd, rt.key, overrides);
      if (rtTotal > rt.inventory) {
        errors.push(
          `第${week.index}周 · ${rt.name}：各渠道配额之和 ${rtTotal} 间超过该房型房量 ${rt.inventory} 间`,
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
        const qErr = quotaError(rtDec.quota);
        if (qErr) errors.push(`第${week.index}周 · ${ch.name}-${rt.name}：${qErr}`);
      }
    }
  }
  return errors;
}

export { CHANNEL_MAP };

export { hasActiveSpecialFactors };

export { DEFAULT_CHANNEL_SIM };
