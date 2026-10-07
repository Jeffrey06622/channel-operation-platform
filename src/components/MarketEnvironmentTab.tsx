import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  TrendingUp,
  Users,
  RotateCcw,
  Loader2,
  Info,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import type {
  MarketBenchmarkRow,
  ChannelBenchmarkRow,
  GuestSegmentBenchmarkRow,
  AppSettingsRow,
} from '../types';
import {
  HOTEL_CLASS_OPTIONS,
  FISCAL_YEARS,
  TREND_METRICS,
  fetchMarketBenchmarks,
  fetchChannelBenchmarks,
  fetchGuestSegmentBenchmarks,
  getTrendSeries,
  getChannelShareByYear,
  getGuestSegmentByYear,
  getChannelColor,
} from '../benchmarks';
import { cn, fmtPct, fmtNum } from '../utils';

interface Props {
  settingsId: string;
  benchmarkFiscalYear: number;
  benchmarkHotelClass: string;
  onSettingsChanged: (fiscalYear: number, hotelClass: string) => void;
}

export default function MarketEnvironmentTab({
  settingsId,
  benchmarkFiscalYear,
  benchmarkHotelClass,
  onSettingsChanged,
}: Props) {
  const [fiscalYear, setFiscalYear] = useState(benchmarkFiscalYear);
  const [hotelClass, setHotelClass] = useState(benchmarkHotelClass);
  const [marketRows, setMarketRows] = useState<MarketBenchmarkRow[]>([]);
  const [channelRows, setChannelRows] = useState<ChannelBenchmarkRow[]>([]);
  const [guestRows, setGuestRows] = useState<GuestSegmentBenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [trendClass, setTrendClass] = useState(benchmarkHotelClass);
  const [toast, setToast] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [market, channel, guest] = await Promise.all([
        fetchMarketBenchmarks(hotelClass),
        fetchChannelBenchmarks(hotelClass),
        fetchGuestSegmentBenchmarks(hotelClass),
      ]);
      setMarketRows(market);
      setChannelRows(channel);
      setGuestRows(guest);
    } catch {
      setToast('数据加载失败，请重试');
    }
    setLoading(false);
  }, [hotelClass]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const hasChanges = fiscalYear !== benchmarkFiscalYear || hotelClass !== benchmarkHotelClass;

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from('app_settings')
      .update({
        benchmark_fiscal_year: fiscalYear,
        benchmark_hotel_class: hotelClass,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settingsId);
    if (error) {
      setToast('保存失败：' + error.message);
    } else {
      onSettingsChanged(fiscalYear, hotelClass);
      setToast('基准设置已保存');
    }
    setSaving(false);
  }

  function handleReset() {
    setFiscalYear(2025);
    setHotelClass('五星');
    setTrendClass('五星');
  }

  const trendMarketRows = marketRows;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
        <span className="ml-3 text-slate-400 text-sm">正在加载市场环境数据...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Benchmark Settings Panel */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-800">基准设置</h2>
          <span className="text-xs text-slate-400">设置学生端市场参考面板的默认基准</span>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">基准年度</label>
            <select
              value={fiscalYear}
              onChange={(e) => setFiscalYear(Number(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            >
              {FISCAL_YEARS.map((y) => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">酒店类别</label>
            <select
              value={hotelClass}
              onChange={(e) => {
                setHotelClass(e.target.value);
                setTrendClass(e.target.value);
              }}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            >
              {HOTEL_CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
            >
              <RotateCcw className="w-4 h-4" />
              恢复默认
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition shadow-md shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>

      {/* 8-Year Industry Trend Charts */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-800">行业8年趋势（2018-2025）</h2>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">星级切换</label>
            <select
              value={trendClass}
              onChange={(e) => setTrendClass(e.target.value)}
              className="px-2.5 py-1 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            >
              {HOTEL_CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <TrendCharts marketRows={trendMarketRows} hotelClass={trendClass} />
      </div>

      {/* Channel Structure Stacked Bar Chart */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-emerald-500" />
          <h2 className="text-sm font-semibold text-slate-800">渠道结构演变（2018→2025）</h2>
        </div>
        <ChannelStackedChart channelRows={channelRows} />
      </div>

      {/* Guest Segment Chart */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-purple-500" />
          <h2 className="text-sm font-semibold text-slate-800">客源结构图</h2>
        </div>
        <GuestSegmentChart guestRows={guestRows} />
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Trend Line Charts (inline SVG) ───────────────────────────────────────────

function TrendCharts({
  marketRows,
  hotelClass,
}: {
  marketRows: MarketBenchmarkRow[];
  hotelClass: string;
}) {
  const [trendData, setTrendData] = useState<MarketBenchmarkRow[]>([]);

  useEffect(() => {
    if (hotelClass === marketRows[0]?.class) {
      setTrendData(marketRows);
    } else {
      fetchMarketBenchmarks(hotelClass).then(setTrendData).catch(() => {});
    }
  }, [hotelClass, marketRows]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {TREND_METRICS.map((metric) => {
        const series = getTrendSeries(trendData, metric.key);
        return (
          <LineChartCard
            key={metric.key}
            title={metric.label}
            unit={metric.unit}
            isPercent={metric.isPercent}
            series={series}
          />
        );
      })}
    </div>
  );
}

function LineChartCard({
  title,
  unit,
  isPercent,
  series,
}: {
  title: string;
  unit: string;
  isPercent: boolean;
  series: { fiscal_year: number; value: number }[];
}) {
  if (series.length < 2) {
    return (
      <div className="border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-slate-700 mb-2">{title}</div>
        <div className="h-48 flex items-center justify-center text-slate-400 text-sm">暂无数据</div>
      </div>
    );
  }

  const width = 520;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 35, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = series.map((s) => s.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const yMin = minVal - range * 0.1;
  const yMax = maxVal + range * 0.1;
  const yRange = yMax - yMin || 1;

  const xScale = (i: number) => padding.left + (chartW * i) / (series.length - 1);
  const yScale = (val: number) => padding.top + chartH - ((val - yMin) / yRange) * chartH;

  const points = series.map((s, i) => `${xScale(i)},${yScale(s.value)}`).join(' ');
  const areaPoints = `${padding.left},${padding.top + chartH} ${points} ${xScale(series.length - 1)},${padding.top + chartH}`;

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (yRange * i) / yTicks);

  function formatVal(v: number): string {
    if (isPercent) return (v * 100).toFixed(1) + '%';
    return fmtNum(v);
  }

  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        <div className="text-xs text-slate-400">单位：{unit}</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ maxHeight: '260px' }}>
        <defs>
          <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Y-axis grid lines and labels */}
        {yTickValues.map((tick, i) => {
          const y = yScale(tick);
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
                strokeDasharray="3,3"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                fill="#94a3b8"
                fontSize="10"
              >
                {formatVal(tick)}
              </text>
            </g>
          );
        })}
        {/* X-axis labels */}
        {series.map((s, i) => (
          <text
            key={s.fiscal_year}
            x={xScale(i)}
            y={height - padding.bottom + 18}
            textAnchor="middle"
            fill="#64748b"
            fontSize="10"
          >
            {s.fiscal_year}
          </text>
        ))}
        {/* Area fill */}
        <polygon points={areaPoints} fill={`url(#grad-${title})`} />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Data points */}
        {series.map((s, i) => (
          <g key={s.fiscal_year}>
            <circle
              cx={xScale(i)}
              cy={yScale(s.value)}
              r="3.5"
              fill="#fff"
              stroke="#3b82f6"
              strokeWidth="2"
            />
            <text
              x={xScale(i)}
              y={yScale(s.value) - 10}
              textAnchor="middle"
              fill="#1e40af"
              fontSize="9"
              fontWeight="600"
            >
              {formatVal(s.value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── Channel Stacked Bar Chart ────────────────────────────────────────────────

function ChannelStackedChart({ channelRows }: { channelRows: ChannelBenchmarkRow[] }) {
  const yearlyData = getChannelShareByYear(channelRows);
  const allChannels = Array.from(
    new Set(channelRows.map((r) => r.channel)),
  ).sort((a, b) => {
    const aSum = channelRows.filter((r) => r.channel === a).reduce((s, r) => s + r.share, 0);
    const bSum = channelRows.filter((r) => r.channel === b).reduce((s, r) => s + r.share, 0);
    return bSum - aSum;
  });

  if (yearlyData.length === 0) {
    return <div className="h-48 flex items-center justify-center text-slate-400 text-sm">暂无数据</div>;
  }

  const width = 720;
  const height = 300;
  const padding = { top: 20, right: 120, bottom: 35, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const barWidth = chartW / yearlyData.length * 0.6;
  const barGap = chartW / yearlyData.length;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ maxHeight: '340px', minWidth: '600px' }}>
        {/* Y-axis grid */}
        {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((tick, i) => {
          const y = padding.top + chartH - tick * chartH;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
                strokeDasharray="3,3"
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10">
                {(tick * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {yearlyData.map((yearData, yearIdx) => {
          let yOffset = 0;
          const x = padding.left + barGap * yearIdx + (barGap - barWidth) / 2;
          return (
            <g key={yearData.fiscal_year}>
              {allChannels.map((channel, chIdx) => {
                const ch = yearData.channels.find((c) => c.channel === channel);
                const share = ch ? ch.share : 0;
                const barH = share * chartH;
                const y = padding.top + chartH - barH - yOffset;
                yOffset += barH;
                if (share === 0) return null;
                return (
                  <rect
                    key={channel}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barH}
                    fill={getChannelColor(chIdx)}
                    stroke="#fff"
                    strokeWidth="0.5"
                  >
                    <title>{`${channel}: ${(share * 100).toFixed(1)}%`}</title>
                  </rect>
                );
              })}
              {/* Year label */}
              <text
                x={x + barWidth / 2}
                y={height - padding.bottom + 18}
                textAnchor="middle"
                fill="#64748b"
                fontSize="10"
              >
                {yearData.fiscal_year}
              </text>
            </g>
          );
        })}
        {/* Legend */}
        {allChannels.map((channel, i) => {
          const legendY = padding.top + i * 18;
          const shortName = channel.length > 8 ? channel.slice(0, 7) + '…' : channel;
          return (
            <g key={channel}>
              <rect
                x={width - padding.right + 10}
                y={legendY}
                width="12"
                height="12"
                rx="2"
                fill={getChannelColor(i)}
              />
              <text
                x={width - padding.right + 28}
                y={legendY + 10}
                fill="#475569"
                fontSize="10"
              >
                {shortName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Guest Segment Chart ──────────────────────────────────────────────────────

function GuestSegmentChart({ guestRows }: { guestRows: GuestSegmentBenchmarkRow[] }) {
  const yearlyData = getGuestSegmentByYear(guestRows);
  const allSegments = Array.from(
    new Set(guestRows.map((r) => r.guest_type)),
  ).sort((a, b) => {
    const aSum = guestRows.filter((r) => r.guest_type === a).reduce((s, r) => s + r.share, 0);
    const bSum = guestRows.filter((r) => r.guest_type === b).reduce((s, r) => s + r.share, 0);
    return bSum - aSum;
  });

  if (yearlyData.length === 0) {
    return <div className="h-48 flex items-center justify-center text-slate-400 text-sm">暂无数据</div>;
  }

  const width = 720;
  const height = 300;
  const padding = { top: 20, right: 130, bottom: 35, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const barWidth = chartW / yearlyData.length * 0.6;
  const barGap = chartW / yearlyData.length;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ maxHeight: '340px', minWidth: '600px' }}>
        {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((tick, i) => {
          const y = padding.top + chartH - tick * chartH;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
                strokeDasharray="3,3"
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10">
                {(tick * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}
        {yearlyData.map((yearData, yearIdx) => {
          let yOffset = 0;
          const x = padding.left + barGap * yearIdx + (barGap - barWidth) / 2;
          return (
            <g key={yearData.fiscal_year}>
              {allSegments.map((seg, segIdx) => {
                const s = yearData.segments.find((c) => c.guest_type === seg);
                const share = s ? s.share : 0;
                const barH = share * chartH;
                const y = padding.top + chartH - barH - yOffset;
                yOffset += barH;
                if (share === 0) return null;
                return (
                  <rect
                    key={seg}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barH}
                    fill={getChannelColor(segIdx)}
                    stroke="#fff"
                    strokeWidth="0.5"
                  >
                    <title>{`${seg}: ${(share * 100).toFixed(1)}%`}</title>
                  </rect>
                );
              })}
              <text
                x={x + barWidth / 2}
                y={height - padding.bottom + 18}
                textAnchor="middle"
                fill="#64748b"
                fontSize="10"
              >
                {yearData.fiscal_year}
              </text>
            </g>
          );
        })}
        {allSegments.map((seg, i) => {
          const legendY = padding.top + i * 16;
          const shortName = seg.length > 10 ? seg.slice(0, 9) + '…' : seg;
          return (
            <g key={seg}>
              <rect
                x={width - padding.right + 10}
                y={legendY}
                width="12"
                height="12"
                rx="2"
                fill={getChannelColor(i)}
              />
              <text
                x={width - padding.right + 28}
                y={legendY + 10}
                fill="#475569"
                fontSize="9"
              >
                {shortName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
