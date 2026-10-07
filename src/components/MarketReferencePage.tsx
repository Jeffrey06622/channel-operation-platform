import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Users,
  Info,
  AlertTriangle,
  Loader2,
  Compass,
  ArrowLeft,
  Lightbulb,
  Users2,
  PencilLine,
  FileEdit,
} from 'lucide-react';
import type {
  BaseParams,
  ChannelSimConfig,
  ChannelMeta,
  ChannelKey,
  RoomTypeKey,
  ChannelBenchmarkRow,
  CycleResult,
  DecisionPayload,
  DecisionRow,
  GuestSegmentBenchmarkRow,
  MarketBenchmarkRow,
  WeekSubmissionRow,
} from '../types';
import {
  FISCAL_YEARS,
  TREND_METRICS,
  fetchMarketBenchmarks,
  fetchChannelBenchmarks,
  fetchGuestSegmentBenchmarks,
  getBenchmarkValue,
  getTrendSeries,
  getChannelShare,
  getGuestSegments,
  getChannelColor,
} from '../benchmarks';
import { WEEKS } from '../domain';
import {
  computePlatformWeekStats,
  computePlatformAllWeeksStats,
  type PlatformWeekStats,
} from '../platformStats';
import { supabase } from '../supabaseClient';
import { cn, fmtPct, fmtNum } from '../utils';

interface Props {
  fiscalYear: number;
  hotelClass: string;
  cycleResult: CycleResult;
  channels: ChannelMeta[];
  baseParams: BaseParams | null;
  channelSim: ChannelSimConfig | null;
  currentWeekKey: string;
  groupId: string;
  payload: DecisionPayload;
  submittedWeeks: Set<string>;
  onBack: () => void;
  onGoToDecision: (weekKey: string) => void;
}

type GroupWeekStatus = 'submitted' | 'draft' | 'empty';

interface WeekInputSummary {
  hasPrice: boolean;
  hasQuota: boolean;
  priceOnlyCount: number;
  quotaOnlyCount: number;
  bothCount: number;
}

function summarizeWeekInput(
  payload: DecisionPayload | undefined,
  weekKey: string,
): WeekInputSummary {
  const weekData = payload?.weeks?.[weekKey];
  if (!weekData?.channels) {
    return { hasPrice: false, hasQuota: false, priceOnlyCount: 0, quotaOnlyCount: 0, bothCount: 0 };
  }
  let priceOnly = 0, quotaOnly = 0, both = 0;
  for (const chKey of Object.keys(weekData.channels)) {
    const ch = weekData.channels[chKey as ChannelKey];
    if (!ch?.roomTypes) continue;
    for (const rtKey of Object.keys(ch.roomTypes)) {
      const rt = ch.roomTypes[rtKey as RoomTypeKey];
      const hasPrice = rt?.price != null && rt.price > 0;
      const hasQuota = rt?.quota != null && rt.quota > 0;
      if (hasPrice && hasQuota) both++;
      else if (hasPrice && !hasQuota) priceOnly++;
      else if (!hasPrice && hasQuota) quotaOnly++;
    }
  }
  return {
    hasPrice: priceOnly > 0 || both > 0,
    hasQuota: quotaOnly > 0 || both > 0,
    priceOnlyCount: priceOnly,
    quotaOnlyCount: quotaOnly,
    bothCount: both,
  };
}

export default function MarketReferencePage({
  fiscalYear,
  hotelClass,
  cycleResult,
  channels,
  baseParams,
  channelSim,
  currentWeekKey,
  groupId,
  payload,
  submittedWeeks,
  onBack,
  onGoToDecision,
}: Props) {
  const [marketRows, setMarketRows] = useState<MarketBenchmarkRow[]>([]);
  const [channelRows, setChannelRows] = useState<ChannelBenchmarkRow[]>([]);
  const [guestRows, setGuestRows] = useState<GuestSegmentBenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendMetric, setTrendMetric] = useState(0);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>(currentWeekKey);

  const [allDecisions, setAllDecisions] = useState<DecisionRow[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<WeekSubmissionRow[]>([]);
  const [platformLoading, setPlatformLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    setPlatformLoading(true);
    try {
      const [market, channel, guest, decRes, subRes] = await Promise.all([
        fetchMarketBenchmarks(hotelClass),
        fetchChannelBenchmarks(hotelClass),
        fetchGuestSegmentBenchmarks(hotelClass),
        supabase.from('decisions').select('*'),
        supabase.from('week_submissions').select('*'),
      ]);
      setMarketRows(market);
      setChannelRows(channel);
      setGuestRows(guest);
      setAllDecisions((decRes.data as DecisionRow[]) || []);
      setAllSubmissions((subRes.data as WeekSubmissionRow[]) || []);
    } catch {
      // silent
    }
    setLoading(false);
    setPlatformLoading(false);
  }, [hotelClass]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setSelectedWeekKey(currentWeekKey);
  }, [currentWeekKey]);

  const platformStats: PlatformWeekStats | null = useMemo(
    () => computePlatformWeekStats(allDecisions, allSubmissions, selectedWeekKey, baseParams, channelSim, groupId),
    [allDecisions, allSubmissions, selectedWeekKey, baseParams, channelSim, groupId],
  );

  const platformAllWeeks = useMemo(
    () => computePlatformAllWeeksStats(allDecisions, allSubmissions, baseParams, channelSim, groupId),
    [allDecisions, allSubmissions, baseParams, channelSim, groupId],
  );

  const benchOccupancy = getBenchmarkValue(marketRows, '平均住宿率（%）', fiscalYear);
  const benchAdr = getBenchmarkValue(marketRows, '平均房价（元/间）', fiscalYear);
  const benchRevpar = getBenchmarkValue(marketRows, '每间可供出租客房收入（元/间）', fiscalYear);
  const benchGrossMargin = getBenchmarkValue(marketRows, '经营毛利率（%）', fiscalYear);

  const selectedWeekResult = cycleResult.weeks.find((w) => w.weekKey === selectedWeekKey);

  // --- Group week data status ---
  const weekInputSummary = useMemo(
    () => summarizeWeekInput(payload, selectedWeekKey),
    [payload, selectedWeekKey],
  );

  const groupWeekStatus: GroupWeekStatus = submittedWeeks.has(selectedWeekKey)
    ? 'submitted'
    : weekInputSummary.bothCount > 0 || weekInputSummary.priceOnlyCount > 0 || weekInputSummary.quotaOnlyCount > 0
      ? 'draft'
      : 'empty';

  const hasComputedResult = selectedWeekResult != null && selectedWeekResult.totalRoomNights > 0;

  // Only use selectedWeekResult values — no fallback to overall
  const actualOccupancy = selectedWeekResult?.occupancy ?? 0;
  const actualAdr = selectedWeekResult && selectedWeekResult.totalRoomNights > 0
    ? selectedWeekResult.grossRevenue / selectedWeekResult.totalRoomNights
    : 0;
  const actualRevpar = selectedWeekResult?.revpar ?? 0;

  // --- Display strings for 本组 ---
  const groupValueNote = groupWeekStatus === 'empty'
    ? '本组当前周尚未填写决策数据'
    : !hasComputedResult
      ? weekInputSummary.priceOnlyCount > 0 && weekInputSummary.quotaOnlyCount === 0 && weekInputSummary.bothCount === 0
        ? '已填价格但缺配额，无法计算出租率/ADR/RevPAR'
        : weekInputSummary.quotaOnlyCount > 0 && weekInputSummary.priceOnlyCount === 0 && weekInputSummary.bothCount === 0
          ? '已填配额但缺价格，无法计算出租率/ADR/RevPAR'
          : '价格或配额不完整，无法计算出租率/ADR/RevPAR'
      : groupWeekStatus === 'draft'
        ? '草稿·未提交'
        : '';

  const groupValueSuffix = groupWeekStatus === 'draft' && hasComputedResult ? ' 草稿' : '';

  function groupDisplay(value: number, fmt: (v: number) => string): string {
    if (groupWeekStatus === 'empty') return '未填写';
    if (!hasComputedResult) return '数据不完整';
    return fmt(value);
  }

  const channelShares = useMemo(() => getChannelShare(channelRows, fiscalYear), [channelRows, fiscalYear]);
  const guestSegments = useMemo(() => getGuestSegments(guestRows, fiscalYear), [guestRows, fiscalYear]);

  const currentMetric = TREND_METRICS[trendMetric];
  const trendData = useMemo(
    () => getTrendSeries(marketRows, currentMetric.key),
    [marketRows, currentMetric],
  );

  // Group channel shares for selected week
  const channelAllocated = useMemo(() => {
    const map = new Map<string, number>();
    const wk = cycleResult.weeks.find((w) => w.weekKey === selectedWeekKey);
    if (wk) {
      for (const ch of wk.channels) {
        map.set(ch.channelKey, (map.get(ch.channelKey) ?? 0) + ch.roomNights);
      }
    }
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    return { map, total };
  }, [cycleResult, selectedWeekKey]);

  const sampleCount = platformStats?.sampleCount ?? 0;
  const lowSample = sampleCount > 0 && sampleCount < 3;

  // Deviation hints (only when we have computed results)
  const deviationHints: { type: 'positive' | 'negative' | 'neutral'; text: string }[] = [];

  if (hasComputedResult) {
    if (benchOccupancy != null && actualOccupancy > 0) {
      const diff = actualOccupancy - benchOccupancy;
      if (Math.abs(diff) > 0.03) {
        deviationHints.push({
          type: diff > 0 ? 'positive' : 'negative',
          text: `本组出租率 ${(actualOccupancy * 100).toFixed(1)}% vs 行业 ${fmtPct(benchOccupancy)}，${diff > 0 ? '高于' : '低于'}行业 ${(Math.abs(diff) * 100).toFixed(1)} 个百分点`,
        });
      }
    }
    if (platformStats && platformStats.avgOccupancy > 0 && actualOccupancy > 0) {
      const diff = actualOccupancy - platformStats.avgOccupancy;
      if (Math.abs(diff) > 0.03) {
        deviationHints.push({
          type: diff > 0 ? 'positive' : 'negative',
          text: `本组出租率 ${(actualOccupancy * 100).toFixed(1)}% vs 平台平均 ${fmtPct(platformStats.avgOccupancy)}，${diff > 0 ? '高于' : '低于'}平台均值 ${(Math.abs(diff) * 100).toFixed(1)} 个百分点`,
        });
      }
    }
    if (benchAdr != null && actualAdr > 0) {
      const diffPct = ((actualAdr - benchAdr) / benchAdr) * 100;
      if (Math.abs(diffPct) > 5) {
        deviationHints.push({
          type: diffPct > 0 ? 'positive' : 'negative',
          text: `本组ADR ${actualAdr.toFixed(0)}元 vs 行业 ${benchAdr}元，${diffPct > 0 ? '高于' : '低于'}行业 ${Math.abs(diffPct).toFixed(1)}%`,
        });
      }
    }
    if (platformStats && platformStats.avgAdr > 0 && actualAdr > 0) {
      const diffPct = ((actualAdr - platformStats.avgAdr) / platformStats.avgAdr) * 100;
      if (Math.abs(diffPct) > 5) {
        deviationHints.push({
          type: diffPct > 0 ? 'positive' : 'negative',
          text: `本组ADR ${actualAdr.toFixed(0)}元 vs 平台平均 ${platformStats.avgAdr.toFixed(0)}元，${diffPct > 0 ? '高于' : '低于'}平台均值 ${Math.abs(diffPct).toFixed(1)}%`,
        });
      }
    }
    if (benchRevpar != null && actualRevpar > 0) {
      const diffPct = ((actualRevpar - benchRevpar) / benchRevpar) * 100;
      if (Math.abs(diffPct) > 5) {
        deviationHints.push({
          type: diffPct > 0 ? 'positive' : 'negative',
          text: `本组RevPAR ${actualRevpar.toFixed(0)}元 vs 行业 ${benchRevpar}元，${diffPct > 0 ? '高于' : '低于'}行业 ${Math.abs(diffPct).toFixed(1)}%`,
        });
      }
    }
    if (platformStats && platformStats.avgRevpar > 0 && actualRevpar > 0) {
      const diffPct = ((actualRevpar - platformStats.avgRevpar) / platformStats.avgRevpar) * 100;
      if (Math.abs(diffPct) > 5) {
        deviationHints.push({
          type: diffPct > 0 ? 'positive' : 'negative',
          text: `本组RevPAR ${actualRevpar.toFixed(0)}元 vs 平台平均 ${platformStats.avgRevpar.toFixed(0)}元，${diffPct > 0 ? '高于' : '低于'}平台均值 ${Math.abs(diffPct).toFixed(1)}%`,
        });
      }
    }
  }

  // Channel-specific deviation hints
  if (channelAllocated.total > 0 && channelShares.length > 0) {
    const socialMediaTotal = channelShares
      .filter((c) => c.channel.includes('社交媒体'))
      .reduce((s, c) => s + c.share, 0);

    const xhsAllocated = (channelAllocated.map.get('xhs') ?? 0) / channelAllocated.total;
    const douyinAllocated = (channelAllocated.map.get('douyin') ?? 0) / channelAllocated.total;
    const contentAllocated = xhsAllocated + douyinAllocated;

    if (contentAllocated > 0.1 && socialMediaTotal > 0) {
      deviationHints.push({
        type: 'neutral',
        text: `社交媒体行业合计占比仅约${(socialMediaTotal * 100).toFixed(1)}%，本组抖音+小红书投放占比${(contentAllocated * 100).toFixed(1)}%，过度投放可能造成空房与营销成本浪费`,
      });
    }

    if (platformStats && platformStats.channelTotalRoomNights > 0) {
      const platformXhs = (platformStats.channelRoomNights.get('xhs') ?? 0) / platformStats.channelTotalRoomNights;
      const platformDouyin = (platformStats.channelRoomNights.get('douyin') ?? 0) / platformStats.channelTotalRoomNights;
      const platformContent = platformXhs + platformDouyin;
      if (platformContent > 0.08 && socialMediaTotal > 0) {
        deviationHints.push({
          type: 'neutral',
          text: `全班平台平均社交媒体投放占比约${(platformContent * 100).toFixed(1)}%，远高于行业${(socialMediaTotal * 100).toFixed(1)}%，集体扎堆新媒体渠道`,
        });
      }
    }
  }

  if (loading || platformLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-teal-500 animate-spin" />
        <span className="ml-2 text-slate-400 text-sm">正在加载市场参考数据...</span>
      </div>
    );
  }

  const platformLabel = `平台平均（基于${selectedWeekKey ? `第${WEEKS.find((w) => w.key === selectedWeekKey)?.index ?? '-'}周` : ''} ${sampleCount}个已提交小组）`;
  const selectedWeekIndex = WEEKS.find((w) => w.key === selectedWeekKey)?.index ?? '-';

  // Status badge for 本组
  const statusBadge = groupWeekStatus === 'submitted' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[11px] font-medium rounded-md border border-emerald-200">
      <FileEdit className="w-3 h-3" /> 已提交
    </span>
  ) : groupWeekStatus === 'draft' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-600 text-[11px] font-medium rounded-md border border-amber-200">
      <PencilLine className="w-3 h-3" /> 草稿·未提交
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-500 text-[11px] font-medium rounded-md border border-slate-200">
      未填写
    </span>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              返回决策
            </button>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-2">
              <Compass className="w-5 h-5 text-teal-500" />
              <h1 className="text-base font-semibold text-slate-800">市场参考</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 hidden sm:inline">查看周次：</span>
            <select
              value={selectedWeekKey}
              onChange={(e) => setSelectedWeekKey(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/20 bg-white"
            >
              {WEEKS.map((w) => (
                <option key={w.key} value={w.key}>第{w.index}周</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* 基准说明条 */}
        <div className="bg-gradient-to-r from-teal-500 to-teal-600 rounded-xl p-4 text-white shadow-md flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 opacity-80" />
            <span className="text-sm font-medium">
              当前数据口径：{fiscalYear}财年 · {hotelClass} · 全国样本
            </span>
          </div>
          <span className="text-xs opacity-70">数据仅供决策参考，不影响评分</span>
        </div>

        {/* 本组数据状态提示 */}
        {groupWeekStatus === 'empty' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <span className="text-sm text-amber-700">
                本组第{selectedWeekIndex}周尚未填写决策数据，无法显示本组指标。
              </span>
            </div>
            <button
              onClick={() => onGoToDecision(selectedWeekKey)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition shadow-sm"
            >
              <PencilLine className="w-4 h-4" />
              去填写第{selectedWeekIndex}周决策
            </button>
          </div>
        )}
        {groupWeekStatus === 'draft' && !hasComputedResult && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
            <span className="text-sm text-orange-700">
              本组第{selectedWeekIndex}周决策数据不完整（{groupValueNote}），请补全价格和配额后才能计算本组指标。
            </span>
          </div>
        )}

        {/* 第一区：行业核心指标 — 三方对比 */}
        <SectionCard icon={<BarChart3 className="w-4 h-4 text-blue-500" />} title="行业核心指标" subtitle={`${fiscalYear}财年 · ${hotelClass} · 三方对比`}>
          {sampleCount === 0 && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-500">当前所选周次暂无已提交小组，平台平均值暂无可比数据。</p>
            </div>
          )}
          {lowSample && sampleCount > 0 && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">当前样本较少（{sampleCount}组），平台平均值仅供参考。</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ThreeWayKpi
              label="平均出租率"
              industry={benchOccupancy != null ? fmtPct(benchOccupancy) : '—'}
              platform={platformStats ? fmtPct(platformStats.avgOccupancy) : '暂无'}
              group={groupDisplay(actualOccupancy, fmtPct)}
              groupStatus={groupWeekStatus}
              hasResult={hasComputedResult}
              sampleCount={sampleCount}
              isPercent
              colorScheme="blue"
            />
            <ThreeWayKpi
              label="平均房价ADR"
              industry={benchAdr != null ? `${fmtNum(benchAdr)}元` : '—'}
              platform={platformStats ? `${platformStats.avgAdr.toFixed(0)}元` : '暂无'}
              group={groupDisplay(actualAdr, (v) => `${v.toFixed(0)}元`)}
              groupStatus={groupWeekStatus}
              hasResult={hasComputedResult}
              sampleCount={sampleCount}
              colorScheme="emerald"
            />
            <ThreeWayKpi
              label="RevPAR"
              industry={benchRevpar != null ? `${fmtNum(benchRevpar)}元` : '—'}
              platform={platformStats ? `${platformStats.avgRevpar.toFixed(0)}元` : '暂无'}
              group={groupDisplay(actualRevpar, (v) => `${v.toFixed(0)}元`)}
              groupStatus={groupWeekStatus}
              hasResult={hasComputedResult}
              sampleCount={sampleCount}
              colorScheme="amber"
            />
            <ThreeWayKpi
              label="经营毛利率"
              industry={benchGrossMargin != null ? fmtPct(benchGrossMargin) : '—'}
              platform="—"
              group="—"
              groupStatus="submitted"
              hasResult={false}
              sampleCount={sampleCount}
              isPercent
              colorScheme="rose"
              platformNote="平台暂无毛利数据"
            />
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {platformLabel} · 平台平均采用加权口径（Σ各组已售间夜 / Σ各组可供间夜），非简单算术平均
          </p>
        </SectionCard>

        {/* 第二区：行业八年趋势 */}
        <SectionCard icon={<TrendingUp className="w-4 h-4 text-indigo-500" />} title="行业八年趋势" subtitle="2018-2025 可切换指标">
          <div className="flex flex-wrap gap-1.5 mb-4">
            {TREND_METRICS.map((m, i) => (
              <button
                key={m.key}
                onClick={() => setTrendMetric(i)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition border',
                  i === trendMetric
                    ? 'bg-indigo-500 text-white border-indigo-500 shadow'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-indigo-50',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <TrendChart data={trendData} metricLabel={currentMetric.label} unit={currentMetric.unit} isPercent={currentMetric.isPercent} />
        </SectionCard>

        {/* 平台各周走势 */}
        {platformAllWeeks.length >= 2 && (
          <SectionCard icon={<Users2 className="w-4 h-4 text-teal-500" />} title="平台各周走势" subtitle="全班平均出租率与RevPAR随周次变化">
            <PlatformTrendChart weeks={platformAllWeeks} />
          </SectionCard>
        )}

        {/* 订房渠道结构 — 三方对比 */}
        {channelShares.length > 0 && (
          <SectionCard icon={<BarChart3 className="w-4 h-4 text-emerald-500" />} title="订房渠道结构" subtitle={`${fiscalYear}财年 · 行业/平台/本组 三方对比`}>
            <div className="space-y-3">
              {channels.map((ch) => {
                const benchShare = channelShares.find((b) =>
                  b.channel.includes(ch.name) || ch.name.includes(b.channel) ||
                  (ch.key === 'xhs' && b.channel.includes('社交媒体')) ||
                  (ch.key === 'douyin' && b.channel.includes('社交媒体')),
                )?.share ?? 0;
                const platformShare = platformStats && platformStats.channelTotalRoomNights > 0
                  ? (platformStats.channelRoomNights.get(ch.key) ?? 0) / platformStats.channelTotalRoomNights
                  : 0;
                const groupShare = channelAllocated.total > 0
                  ? (channelAllocated.map.get(ch.key) ?? 0) / channelAllocated.total
                  : 0;
                const hasAny = benchShare > 0 || platformShare > 0 || groupShare > 0 || groupWeekStatus !== 'empty';
                if (!hasAny) return null;
                return (
                  <div key={ch.key} className="flex flex-col gap-1 py-1">
                    <div className="text-xs font-medium text-slate-700">{ch.name}</div>
                    <ThreeBarRow label="行业" value={benchShare} color="#94a3b8" />
                    <ThreeBarRow label="平台" value={platformShare} color="#2dd4bf" showZero={platformStats != null} />
                    {groupWeekStatus === 'empty' ? (
                      <ThreeBarRow label="本组" value={0} color="#fbbf24" emptyText="未填写" />
                    ) : !hasComputedResult ? (
                      <ThreeBarRow label="本组" value={0} color="#fbbf24" emptyText="数据不完整" />
                    ) : (
                      <ThreeBarRow label="本组" value={groupShare} color="#fbbf24" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 leading-relaxed">
                社交媒体（含抖音、小红书）行业合计占比仅约{(channelShares.filter((c) => c.channel.includes('社交媒体')).reduce((s, c) => s + c.share, 0) * 100).toFixed(1)}%，是补充渠道而非主力渠道。
              </p>
            </div>
            <p className="text-xs text-slate-400 mt-2">{platformLabel}</p>
          </SectionCard>
        )}

        {/* 客源结构 */}
        {guestSegments.length > 0 && (
          <SectionCard icon={<Users className="w-4 h-4 text-purple-500" />} title="客源结构" subtitle={`${fiscalYear}财年 · 各客源类型占比`}>
            <div className="space-y-2.5">
              {guestSegments.map((seg, i) => (
                <div key={seg.guest_type} className="flex items-center gap-3">
                  <div className="w-28 sm:w-32 text-xs text-slate-600 truncate flex-shrink-0" title={seg.guest_type}>
                    {seg.guest_type}
                  </div>
                  <div className="flex-1 h-6 bg-slate-50 rounded-lg overflow-hidden relative min-w-0">
                    <div
                      className="h-full rounded-lg transition-all duration-500"
                      style={{
                        width: `${Math.min(100, seg.share * 100)}%`,
                        backgroundColor: getChannelColor(i + 4),
                      }}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-700 whitespace-nowrap">
                      {(seg.share * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* 本组对标 — 三方对比 */}
        <SectionCard icon={<Compass className="w-4 h-4 text-amber-500" />} title="本组对标" subtitle="行业基准 / 平台平均 / 本组 三方对比">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-slate-500">本组第{selectedWeekIndex}周状态：</span>
            {statusBadge}
          </div>

          <div className="space-y-3">
            <ThreeWayComparisonRow
              label="出租率"
              industry={benchOccupancy != null ? fmtPct(benchOccupancy) : '—'}
              industryRaw={benchOccupancy}
              platform={platformStats ? fmtPct(platformStats.avgOccupancy) : '暂无'}
              platformRaw={platformStats?.avgOccupancy ?? null}
              group={groupDisplay(actualOccupancy, fmtPct)}
              groupRaw={hasComputedResult ? actualOccupancy : 0}
              groupHasData={hasComputedResult}
              isPercent
            />
            <ThreeWayComparisonRow
              label="ADR"
              industry={benchAdr != null ? `${fmtNum(benchAdr)}元` : '—'}
              industryRaw={benchAdr}
              platform={platformStats ? `${platformStats.avgAdr.toFixed(0)}元` : '暂无'}
              platformRaw={platformStats?.avgAdr ?? null}
              group={groupDisplay(actualAdr, (v) => `${v.toFixed(0)}元`)}
              groupRaw={hasComputedResult ? actualAdr : 0}
              groupHasData={hasComputedResult}
            />
            <ThreeWayComparisonRow
              label="RevPAR"
              industry={benchRevpar != null ? `${fmtNum(benchRevpar)}元` : '—'}
              industryRaw={benchRevpar}
              platform={platformStats ? `${platformStats.avgRevpar.toFixed(0)}元` : '暂无'}
              platformRaw={platformStats?.avgRevpar ?? null}
              group={groupDisplay(actualRevpar, (v) => `${v.toFixed(0)}元`)}
              groupRaw={hasComputedResult ? actualRevpar : 0}
              groupHasData={hasComputedResult}
            />
          </div>

          {/* Empty state action */}
          {groupWeekStatus === 'empty' && (
            <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg">
              <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="text-sm text-slate-500 flex-1">本组第{selectedWeekIndex}周尚未填写决策数据</span>
              <button
                onClick={() => onGoToDecision(selectedWeekKey)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 transition"
              >
                <PencilLine className="w-3.5 h-3.5" />
                去填写
              </button>
            </div>
          )}

          <p className="text-xs text-slate-400 mt-3">{platformLabel}</p>

          {deviationHints.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-600 mb-3">偏离提示</h4>
              <div className="space-y-2">
                {deviationHints.map((hint, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm leading-relaxed',
                      hint.type === 'positive'
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                        : hint.type === 'negative'
                          ? 'bg-amber-50 border border-amber-200 text-amber-700'
                          : 'bg-slate-50 border border-slate-200 text-slate-600',
                    )}
                  >
                    {hint.type === 'positive' ? (
                      <TrendingUp className="w-4 h-4 mt-0.5 shrink-0" />
                    ) : hint.type === 'negative' ? (
                      <TrendingDown className="w-4 h-4 mt-0.5 shrink-0" />
                    ) : (
                      <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    )}
                    <span>{hint.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* 市场解读 */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-800">市场解读</h3>
          </div>
          <ul className="space-y-2 text-sm text-slate-600 leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="text-teal-400 mt-0.5">•</span>
              <span>OTA与协议客户是间夜主力渠道，合计占比超60%，应作为投放重点保障。</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-teal-400 mt-0.5">•</span>
              <span>新媒体（抖音、小红书）行业合计占比仅约3%，当期转化低、长尾为主，宜作补充而非主力渠道。</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-teal-400 mt-0.5">•</span>
              <span>定价参考行业ADR（{benchAdr != null ? `${benchAdr}元` : '—'}），过高损失转化率，过低损失RevPAR。</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-teal-400 mt-0.5">•</span>
              <span>行业RevPAR {benchRevpar != null ? `${benchRevpar}元` : '—'} 是综合竞争力标杆，出租率与ADR的平衡优于单维度追求。</span>
            </li>
            {sampleCount > 0 && (
              <li className="flex items-start gap-2">
                <span className="text-teal-400 mt-0.5">•</span>
                <span>平台全班平均RevPAR {platformStats ? `${platformStats.avgRevpar.toFixed(0)}元` : '—'}（{sampleCount}组样本），是同班竞争的直接参照。</span>
              </li>
            )}
          </ul>
        </div>

        <div className="flex justify-center pt-2 pb-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-500 text-white text-sm font-medium rounded-xl hover:bg-teal-600 transition shadow-md shadow-teal-500/20"
          >
            <ArrowLeft className="w-4 h-4" />
            返回决策填写
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

const COLOR_SCHEMES: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-100' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-100' },
};

function ThreeWayKpi({
  label,
  industry,
  platform,
  group,
  groupStatus,
  hasResult,
  sampleCount,
  isPercent,
  colorScheme,
  platformNote,
}: {
  label: string;
  industry: string;
  platform: string;
  group: string;
  groupStatus: GroupWeekStatus;
  hasResult: boolean;
  sampleCount: number;
  isPercent?: boolean;
  colorScheme: string;
  platformNote?: string;
}) {
  const cs = COLOR_SCHEMES[colorScheme] ?? COLOR_SCHEMES.blue;
  const isDraft = groupStatus === 'draft' && hasResult;
  const isEmpty = group === '未填写';
  const isIncomplete = group === '数据不完整';
  return (
    <div className={cn('rounded-lg p-4 border', cs.bg, cs.border)}>
      <div className="text-xs opacity-70 mb-2 font-medium">{label}</div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-slate-500">行业基准</span>
          <span className={cn('text-lg font-bold', cs.text)}>{industry}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-slate-500">平台平均{sampleCount > 0 ? `（${sampleCount}组）` : ''}</span>
          <span className="text-lg font-bold text-teal-600">{platform}</span>
        </div>
        <div className="flex items-baseline justify-between pt-1 border-t border-white/50">
          <span className="text-[11px] text-slate-500">
            本组{isDraft && <span className="text-amber-500 ml-1">·草稿</span>}
          </span>
          <span className={cn(
            'text-lg font-bold',
            isEmpty ? 'text-slate-300 text-sm' : isIncomplete ? 'text-orange-500 text-sm' : 'text-slate-800',
          )}>
            {group}
          </span>
        </div>
      </div>
      {platformNote && <div className="text-[10px] text-slate-400 mt-1">{platformNote}</div>}
    </div>
  );
}

function ThreeBarRow({ label, value, color, showZero, emptyText }: { label: string; value: number; color: string; showZero?: boolean; emptyText?: string }) {
  const pct = (value * 100).toFixed(1);
  const hasValue = value > 0 || showZero;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-400 w-10 flex-shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-slate-50 rounded overflow-hidden min-w-0">
        {hasValue && !emptyText && (
          <div className="h-full rounded transition-all duration-500" style={{ width: `${Math.min(100, value * 100)}%`, backgroundColor: color }} />
        )}
      </div>
      <span className={cn('font-medium w-12 text-right flex-shrink-0', emptyText ? 'text-slate-300 text-[10px]' : 'text-slate-700')}>
        {emptyText ?? (hasValue ? `${pct}%` : '—')}
      </span>
    </div>
  );
}

function ThreeWayComparisonRow({
  label,
  industry,
  industryRaw,
  platform,
  platformRaw,
  group,
  groupRaw,
  groupHasData,
  isPercent,
}: {
  label: string;
  industry: string;
  industryRaw: number | null;
  platform: string;
  platformRaw: number | null;
  group: string;
  groupRaw: number;
  groupHasData: boolean;
  isPercent?: boolean;
}) {
  const hasPlatform = platformRaw != null && platformRaw > 0;

  const diffVsIndustry = industryRaw != null && groupHasData ? groupRaw - industryRaw : null;
  const diffVsPlatform = hasPlatform && groupHasData ? groupRaw - platformRaw! : null;

  const industryDiffPct = industryRaw != null && groupHasData && industryRaw !== 0 ? ((groupRaw - industryRaw) / industryRaw) * 100 : null;
  const platformDiffPct = hasPlatform && groupHasData && platformRaw !== 0 ? ((groupRaw - platformRaw!) / platformRaw!) * 100 : null;

  function diffBadge(diffPct: number | null, isPercentMetric?: boolean, diff: number | null): React.ReactNode {
    if (diffPct === null || diff === null) return <span className="text-slate-300">—</span>;
    const isNeutral = Math.abs(diffPct) < 1;
    const isPositive = diff > 0;
    if (isNeutral) return <span className="text-slate-400">持平</span>;
    return (
      <span className={cn('font-semibold flex items-center gap-0.5', isPositive ? 'text-emerald-600' : 'text-amber-600')}>
        {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {isPercentMetric ? `${isPositive ? '+' : ''}${(diff * 100).toFixed(1)}pp` : `${isPositive ? '+' : ''}${diffPct.toFixed(1)}%`}
      </span>
    );
  }

  const groupIsEmpty = group === '未填写';
  const groupIsIncomplete = group === '数据不完整';

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <div className="w-16 text-sm font-medium text-slate-600 flex-shrink-0 pt-0.5">{label}</div>
      <div className="flex-1 grid grid-cols-4 gap-2 text-sm min-w-0">
        <div>
          <div className="text-xs text-slate-400">行业基准</div>
          <div className="font-semibold text-slate-600">{industry}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">平台平均</div>
          <div className="font-semibold text-teal-600">{platform}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">本组</div>
          <div className={cn('font-semibold', groupIsEmpty ? 'text-slate-300' : groupIsIncomplete ? 'text-orange-500' : 'text-slate-800')}>
            {group}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400">vs行业 / vs平台</div>
          <div className="flex flex-col gap-0.5">
            <div>{diffBadge(industryDiffPct, isPercent, diffVsIndustry)}</div>
            <div>{diffBadge(platformDiffPct, isPercent, diffVsPlatform)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrendChart({
  data,
  metricLabel,
  unit,
  isPercent,
}: {
  data: { fiscal_year: number; value: number }[];
  metricLabel: string;
  unit: string;
  isPercent: boolean;
}) {
  if (data.length < 2) {
    return <div className="text-center text-sm text-slate-400 py-8">暂无趋势数据</div>;
  }

  const width = 720;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 36, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // For percentage metrics, values are stored as decimals (0.639 = 63.9%).
  // Convert to display scale (0-100) so Y-axis and labels read correctly.
  const toDisplay = (v: number) => (isPercent ? v * 100 : v);
  const displayValues = data.map((d) => toDisplay(d.value));
  const minVal = Math.min(...displayValues, 0);
  const maxVal = isPercent ? 100 : Math.max(...displayValues, 1);
  const range = maxVal - minVal || 1;

  const xScale = (i: number) => padding.left + (i / (data.length - 1)) * chartW;
  const yScale = (v: number) => padding.top + chartH - ((v - minVal) / range) * chartH;

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(toDisplay(d.value))}`).join(' ');
  const areaPath = `${linePath} L ${xScale(data.length - 1)} ${padding.top + chartH} L ${xScale(0)} ${padding.top + chartH} Z`;

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => minVal + (range * i) / yTicks);
  const fmtTick = (tv: number) => (isPercent ? `${tv.toFixed(0)}%` : tv >= 100 ? tv.toFixed(0) : tv.toFixed(1));
  const fmtPoint = (v: number) => (isPercent ? `${toDisplay(v).toFixed(1)}%` : v.toFixed(0));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[600px] h-auto" style={{ maxHeight: '280px' }}>
        {tickValues.map((tv, i) => (
          <g key={i}>
            <line x1={padding.left} x2={width - padding.right} y1={yScale(tv)} y2={yScale(tv)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
            <text x={padding.left - 8} y={yScale(tv) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
              {fmtTick(tv)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="rgba(99,102,241,0.08)" />
        <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={d.fiscal_year}>
            <circle cx={xScale(i)} cy={yScale(toDisplay(d.value))} r="4" fill="#6366f1" />
            <circle cx={xScale(i)} cy={yScale(toDisplay(d.value))} r="2" fill="white" />
            <text x={xScale(i)} y={height - padding.bottom + 18} textAnchor="middle" fontSize="10" fill="#64748b">{d.fiscal_year}</text>
            <text x={xScale(i)} y={yScale(toDisplay(d.value)) - 10} textAnchor="middle" fontSize="10" fill="#475569" fontWeight="600">
              {fmtPoint(d.value)}
            </text>
          </g>
        ))}
      </svg>
      <div className="text-center text-xs text-slate-400 mt-1">
        {metricLabel}（{unit}）· 2018-2025年行业趋势
      </div>
    </div>
  );
}

function PlatformTrendChart({ weeks }: { weeks: { weekIndex: number; avgOccupancy: number; avgRevpar: number; sampleCount: number }[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (weeks.length < 2) {
    return <div className="text-center text-sm text-slate-400 py-8">暂无平台走势数据</div>;
  }

  const width = 760;
  const height = 260;
  const padding = { top: 28, right: 60, bottom: 48, left: 56 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Occupancy is stored as decimal (0-1), display as 0-100%
  const occDisplay = weeks.map((w) => w.avgOccupancy * 100);
  const revparValues = weeks.map((w) => w.avgRevpar);

  const maxOcc = Math.ceil(Math.max(...occDisplay, 1) / 10) * 10;
  const maxRevpar = Math.ceil(Math.max(...revparValues, 1) / 50) * 50;

  const xScale = (i: number) => padding.left + (i / (weeks.length - 1)) * chartW;
  const occY = (v: number) => padding.top + chartH - (v / maxOcc) * chartH;
  const revparY = (v: number) => padding.top + chartH - (v / maxRevpar) * chartH;

  const occPath = weeks.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${occY(d.avgOccupancy * 100)}`).join(' ');
  const revparPath = weeks.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${revparY(d.avgRevpar)}`).join(' ');

  const yTicks = 4;
  const occTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxOcc * i) / yTicks);
  const revparTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxRevpar * i) / yTicks);

  // Stagger labels vertically to avoid overlap on narrow screens
  const labelOffset = (i: number) => (i % 2 === 0 ? -12 : -24);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[600px] h-auto"
        style={{ maxHeight: '300px' }}
        onTouchStart={() => setHovered(null)}
      >
        {/* Grid lines + dual Y-axis tick labels */}
        {occTicks.map((tv, i) => {
          const y = occY(tv);
          return (
            <g key={`grid-${i}`}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
              {/* Left axis: occupancy % */}
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#2dd4bf" fontWeight="600">
                {tv.toFixed(0)}%
              </text>
              {/* Right axis: RevPAR 元 */}
              <text x={width - padding.right + 8} y={y + 4} textAnchor="start" fontSize="10" fill="#fbbf24" fontWeight="600">
                {revparTicks[i].toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={padding.left - 40} y={padding.top - 10} fontSize="10" fill="#2dd4bf" fontWeight="600">出租率(%)</text>
        <text x={width - padding.right + 20} y={padding.top - 10} fontSize="10" fill="#fbbf24" fontWeight="600" textAnchor="end">RevPAR(元)</text>

        {/* Occupancy line (teal, left axis) */}
        <path d={occPath} fill="none" stroke="#2dd4bf" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {weeks.map((d, i) => (
          <g key={`occ-${d.weekIndex}`}>
            <circle
              cx={xScale(i)}
              cy={occY(d.avgOccupancy * 100)}
              r={hovered === i ? 6 : 4}
              fill="#2dd4bf"
              stroke="white"
              strokeWidth="1.5"
              className="cursor-pointer transition-all"
            />
            {/* Occ value label */}
            <text
              x={xScale(i)}
              y={occY(d.avgOccupancy * 100) + labelOffset(i)}
              textAnchor="middle"
              fontSize="10"
              fill="#0d9488"
              fontWeight="600"
            >
              {(d.avgOccupancy * 100).toFixed(1)}%
            </text>
          </g>
        ))}

        {/* RevPAR line (amber, right axis) */}
        <path d={revparPath} fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {weeks.map((d, i) => (
          <g key={`rev-${d.weekIndex}`}>
            <circle
              cx={xScale(i)}
              cy={revparY(d.avgRevpar)}
              r={hovered === i ? 6 : 4}
              fill="#fbbf24"
              stroke="white"
              strokeWidth="1.5"
              className="cursor-pointer transition-all"
            />
            {/* RevPAR value label */}
            <text
              x={xScale(i)}
              y={revparY(d.avgRevpar) + (i % 2 === 0 ? 18 : 30)}
              textAnchor="middle"
              fontSize="10"
              fill="#b45309"
              fontWeight="600"
            >
              {d.avgRevpar.toFixed(0)}元
            </text>
          </g>
        ))}

        {/* X-axis labels: week + sample count */}
        {weeks.map((d, i) => (
          <g key={`x-${d.weekIndex}`}>
            <text x={xScale(i)} y={height - padding.bottom + 16} textAnchor="middle" fontSize="10" fill="#64748b">
              W{d.weekIndex}
            </text>
            <text x={xScale(i)} y={height - padding.bottom + 30} textAnchor="middle" fontSize="9" fill="#94a3b8">
              N={d.sampleCount}
            </text>
          </g>
        ))}

        {/* Transparent hit areas for touch/click */}
        {weeks.map((d, i) => (
          <rect
            key={`hit-${d.weekIndex}`}
            x={xScale(i) - 18}
            y={padding.top}
            width={36}
            height={chartH}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onTouchStart={(e) => { e.preventDefault(); setHovered(i); }}
            onClick={() => setHovered(i)}
          />
        ))}

        {/* Tooltip on hover/tap */}
        {hovered != null && weeks[hovered] && (
          <g>
            <line
              x1={xScale(hovered)}
              x2={xScale(hovered)}
              y1={padding.top}
              y2={padding.top + chartH}
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <g transform={`translate(${Math.min(xScale(hovered) + 8, width - 160)}, ${padding.top + 4})`}>
              <rect width="152" height="58" rx="6" fill="white" stroke="#e2e8f0" strokeWidth="1" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.08))" />
              <text x="10" y="16" fontSize="11" fill="#475569" fontWeight="600">第{weeks[hovered].weekIndex}周</text>
              <text x="10" y="32" fontSize="10" fill="#0d9488">出租率: {(weeks[hovered].avgOccupancy * 100).toFixed(1)}%</text>
              <text x="10" y="46" fontSize="10" fill="#b45309">RevPAR: {weeks[hovered].avgRevpar.toFixed(1)}元 · {weeks[hovered].sampleCount}组已提交</text>
            </g>
          </g>
        )}
      </svg>
      <div className="text-center text-xs text-slate-400 mt-1">
        全班平台平均走势 · 点击/长按数据点查看详情
      </div>
    </div>
  );
}
