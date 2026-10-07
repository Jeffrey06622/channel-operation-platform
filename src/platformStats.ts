import type {
  BaseParams,
  ChannelSimConfig,
  CycleResult,
  DecisionPayload,
  DecisionRow,
  WeekSubmissionRow,
} from './types';
import { computeCycle } from './calc';
import { WEEKS, resolveTotalRooms } from './domain';

export interface PlatformWeekStats {
  sampleCount: number;
  totalRoomNights: number;
  totalAvailableRooms: number;
  totalGrossRevenue: number;
  totalCommission: number;
  totalContentCost: number;
  totalNetContribution: number;
  avgOccupancy: number;
  avgAdr: number;
  avgRevpar: number;
  avgNetContribution: number;
  channelRoomNights: Map<string, number>;
  channelTotalRoomNights: number;
}

export function computePlatformWeekStats(
  decisions: DecisionRow[],
  submissions: WeekSubmissionRow[],
  weekKey: string,
  baseParams: BaseParams | null,
  channelSim: ChannelSimConfig | null,
  excludeGroupId?: string,
): PlatformWeekStats | null {
  const submittedGroupIds = new Set(
    submissions
      .filter((s) => s.week_key === weekKey)
      .map((s) => s.group_id),
  );

  const relevantDecisions = decisions.filter(
    (d) => submittedGroupIds.has(d.group_id) && d.group_id !== excludeGroupId,
  );

  if (relevantDecisions.length === 0) return null;

  let totalRoomNights = 0;
  let totalAvailableRooms = 0;
  let totalGrossRevenue = 0;
  let totalCommission = 0;
  let totalContentCost = 0;
  let totalNetContribution = 0;
  const channelRoomNights = new Map<string, number>();

  for (const d of relevantDecisions) {
    const cycle: CycleResult = computeCycle(d.payload, baseParams, channelSim, d.group_id);
    const weekResult = cycle.weeks.find((w) => w.weekKey === weekKey);
    if (!weekResult) continue;

    const totalRooms = resolveTotalRooms(baseParams);
    totalAvailableRooms += totalRooms * weekResult.days;
    totalRoomNights += weekResult.totalRoomNights;
    totalGrossRevenue += weekResult.grossRevenue;
    totalCommission += weekResult.totalCommission;
    totalContentCost += weekResult.totalContentCost;
    totalNetContribution += weekResult.totalNetContribution;

    for (const ch of weekResult.channels) {
      channelRoomNights.set(
        ch.channelKey,
        (channelRoomNights.get(ch.channelKey) ?? 0) + ch.roomNights,
      );
    }
  }

  const channelTotalRoomNights = Array.from(channelRoomNights.values()).reduce((s, v) => s + v, 0);

  return {
    sampleCount: relevantDecisions.length,
    totalRoomNights,
    totalAvailableRooms,
    totalGrossRevenue,
    totalCommission,
    totalContentCost,
    totalNetContribution,
    avgOccupancy: totalAvailableRooms > 0 ? totalRoomNights / totalAvailableRooms : 0,
    avgAdr: totalRoomNights > 0 ? totalGrossRevenue / totalRoomNights : 0,
    avgRevpar: totalAvailableRooms > 0 ? totalGrossRevenue / totalAvailableRooms : 0,
    avgNetContribution: totalNetContribution / relevantDecisions.length,
    channelRoomNights,
    channelTotalRoomNights,
  };
}

export interface PlatformAllWeeksStats {
  weekKey: string;
  weekIndex: number;
  avgOccupancy: number;
  avgRevpar: number;
  sampleCount: number;
}

export function computePlatformAllWeeksStats(
  decisions: DecisionRow[],
  submissions: WeekSubmissionRow[],
  baseParams: BaseParams | null,
  channelSim: ChannelSimConfig | null,
  excludeGroupId?: string,
): PlatformAllWeeksStats[] {
  const results: PlatformAllWeeksStats[] = [];

  for (const w of WEEKS) {
    const stats = computePlatformWeekStats(
      decisions,
      submissions,
      w.key,
      baseParams,
      channelSim,
      excludeGroupId,
    );
    if (stats && stats.sampleCount > 0) {
      results.push({
        weekKey: w.key,
        weekIndex: w.index,
        avgOccupancy: stats.avgOccupancy,
        avgRevpar: stats.avgRevpar,
        sampleCount: stats.sampleCount,
      });
    }
  }

  return results;
}
