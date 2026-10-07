import { supabase } from './supabaseClient';
import type {
  MarketBenchmarkRow,
  ChannelBenchmarkRow,
  GuestSegmentBenchmarkRow,
} from './types';

export const HOTEL_CLASS_OPTIONS = ['五星', '国际管理-五星', '一线城市-五星'] as const;

export const FISCAL_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const HOTEL_CLASS_TO_SECTION: Record<string, string> = {
  '五星': '星级分类',
  '国际管理-五星': '管理模式分类',
  '一线城市-五星': '城市等级分类',
};

export const TREND_METRICS = [
  { key: '平均住宿率（%）', label: '出租率', unit: '%', isPercent: true },
  { key: '平均房价（元/间）', label: 'ADR', unit: '元', isPercent: false },
  { key: '每间可供出租客房收入（元/间）', label: 'RevPAR', unit: '元', isPercent: false },
  { key: '经营毛利率（%）', label: '经营毛利率', unit: '%', isPercent: true },
] as const;

export async function fetchMarketBenchmarks(
  hotelClass: string,
): Promise<MarketBenchmarkRow[]> {
  const section = HOTEL_CLASS_TO_SECTION[hotelClass] ?? '星级分类';
  const { data, error } = await supabase
    .from('market_benchmarks')
    .select('*')
    .eq('section', section)
    .eq('class', hotelClass);
  if (error) throw error;
  return (data as MarketBenchmarkRow[]) ?? [];
}

export async function fetchChannelBenchmarks(
  hotelClass: string,
): Promise<ChannelBenchmarkRow[]> {
  const section = HOTEL_CLASS_TO_SECTION[hotelClass] ?? '星级分类';
  const { data, error } = await supabase
    .from('channel_benchmarks')
    .select('*')
    .eq('section', section)
    .eq('hotel_class', hotelClass);
  if (error) throw error;
  return (data as ChannelBenchmarkRow[]) ?? [];
}

export async function fetchGuestSegmentBenchmarks(
  hotelClass: string,
): Promise<GuestSegmentBenchmarkRow[]> {
  const section = HOTEL_CLASS_TO_SECTION[hotelClass] ?? '星级分类';
  const { data, error } = await supabase
    .from('guest_segment_benchmarks')
    .select('*')
    .eq('section', section)
    .eq('hotel_class', hotelClass);
  if (error) throw error;
  return (data as GuestSegmentBenchmarkRow[]) ?? [];
}

export interface TrendDataPoint {
  fiscal_year: number;
  value: number;
}

export function getTrendSeries(
  rows: MarketBenchmarkRow[],
  metricKey: string,
): TrendDataPoint[] {
  return FISCAL_YEARS.map((year) => {
    const row = rows.find((r) => r.metric === metricKey && r.fiscal_year === year);
    return { fiscal_year: year, value: row ? row.value : NaN };
  }).filter((p) => !isNaN(p.value));
}

export interface ChannelShareData {
  fiscal_year: number;
  channels: { channel: string; share: number }[];
}

export function getChannelShareByYear(
  rows: ChannelBenchmarkRow[],
): ChannelShareData[] {
  return FISCAL_YEARS.map((year) => {
    const yearRows = rows.filter((r) => r.fiscal_year === year);
    return {
      fiscal_year: year,
      channels: yearRows.map((r) => ({ channel: r.channel, share: r.share })),
    };
  }).filter((d) => d.channels.length > 0);
}

export interface GuestSegmentData {
  fiscal_year: number;
  segments: { guest_type: string; share: number }[];
}

export function getGuestSegmentByYear(
  rows: GuestSegmentBenchmarkRow[],
): GuestSegmentData[] {
  return FISCAL_YEARS.map((year) => {
    const yearRows = rows.filter((r) => r.fiscal_year === year);
    return {
      fiscal_year: year,
      segments: yearRows.map((r) => ({ guest_type: r.guest_type, share: r.share })),
    };
  }).filter((d) => d.segments.length > 0);
}

export function getBenchmarkValue(
  rows: MarketBenchmarkRow[],
  metricKey: string,
  fiscalYear: number,
): number | null {
  const row = rows.find((r) => r.metric === metricKey && r.fiscal_year === fiscalYear);
  return row ? row.value : null;
}

export function getChannelShare(
  rows: ChannelBenchmarkRow[],
  fiscalYear: number,
): { channel: string; share: number }[] {
  return rows
    .filter((r) => r.fiscal_year === fiscalYear)
    .map((r) => ({ channel: r.channel, share: r.share }))
    .sort((a, b) => b.share - a.share);
}

export function getGuestSegments(
  rows: GuestSegmentBenchmarkRow[],
  fiscalYear: number,
): { guest_type: string; share: number }[] {
  return rows
    .filter((r) => r.fiscal_year === fiscalYear)
    .map((r) => ({ guest_type: r.guest_type, share: r.share }))
    .sort((a, b) => b.share - a.share);
}

const CHANNEL_COLORS = [
  '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626',
  '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5',
  '#9333ea', '#be185d', '#b45309', '#1d4ed8', '#047857',
];

export function getChannelColor(index: number): string {
  return CHANNEL_COLORS[index % CHANNEL_COLORS.length];
}
