export type ChannelKey = string;
export type RoomTypeKey = string;

export interface RoomTypeMeta {
  key: RoomTypeKey;
  name: string;
  shortName: string;
  inventory: number;
  priceMultiplier: number;
  description: string;
}

export interface ChannelMeta {
  key: ChannelKey;
  name: string;
  shortName: string;
  icon: string;
  basePrice: number;
  rackRate: number;
  commissionRate: number;
  description: string;
}

export interface WeekMeta {
  key: string;
  index: number;
  label: string;
  startDate: string;
  endDate: string;
  days: number;
  isPeak: boolean;
  peakTag: string;
  baseOccupancy: number;
}

export interface SpecialFactorMeta {
  key: string;
  name: string;
  demandMultiplier: number;
  description: string;
}

export interface LongTailRelease {
  offset: number;
  rate: number;
}

export interface ChannelSimParams {
  baseConversionRate: number;
  trafficCap: number;
  currentWeekConfirmRate: number;
  longTailReleases: LongTailRelease[];
  coldStartWeeks: number;
  coldStartDiscount: number;
  weeklyFixedCost: number;
  perRoomNightCost: number;
  viralProbability: number;
  viralMultiplier: number;
  viralCapRelax: number;
  impressionMultiplier: number;
  baseClickRate: number;
}

export interface ChannelSimConfig {
  channels: Record<string, ChannelSimParams>;
  priceSensitivity: number;
}

export interface RoomTypeDecision {
  price: number | null;
  quota: number | null;
  weekend_pricing_enabled?: boolean;
  weekend_days?: number[];
  weekday_price?: number | null;
  weekend_price?: number | null;
}

export interface ChannelDecision {
  roomTypes: Record<RoomTypeKey, RoomTypeDecision>;
}

export interface WeekDecision {
  channels: Record<ChannelKey, ChannelDecision>;
  specialFactors: string[];
}

export type DecisionPayload = {
  weeks: Record<string, WeekDecision>;
};

export interface RoomTypeResult {
  roomTypeKey: RoomTypeKey;
  roomTypeName: string;
  roomNights: number;
  adr: number;
  grossRevenue: number;
  commission: number;
  netRevenue: number;
}

export interface ChannelResult {
  channelKey: ChannelKey;
  channelName: string;
  roomTypes: RoomTypeResult[];
  roomNights: number;
  grossRevenue: number;
  commission: number;
  netRevenue: number;
  allocatedQuota: number;
  impressions: number;
  clickRate: number;
  conversionRate: number;
  confirmedRoomNights: number;
  pendingRoomNights: number;
  contentCost: number;
  totalCost: number;
  netContribution: number;
  quotaExceedsCap: boolean;
  isViral: boolean;
}

export interface WeekResult {
  weekKey: string;
  weekLabel: string;
  days: number;
  channels: ChannelResult[];
  roomTypes: RoomTypeResult[];
  totalRoomNights: number;
  occupancy: number;
  revpar: number;
  grossRevenue: number;
  totalCommission: number;
  netRevenue: number;
  totalContentCost: number;
  totalNetContribution: number;
}

export interface CycleResult {
  weeks: WeekResult[];
  totalRoomNights: number;
  totalRoomNightsAvailable: number;
  overallOccupancy: number;
  overallRevpar: number;
  totalGrossRevenue: number;
  totalCommission: number;
  totalNetRevenue: number;
  totalContentCost: number;
  totalNetContribution: number;
  potentialLongTailValue: number;
}

export interface GroupRow {
  id: string;
  name: string;
  /**
   * Password columns are optional: after the batch-2 database hardening the
   * browser can no longer read them, and password operations go through
   * server-side RPCs (verify_group_login / change_group_password /
   * reset_group_password) instead of direct column access.
   */
  password_hash?: string;
  password_plain?: string;
  hotel_name: string;
  class_label: string;
  created_at: string;
}

export interface CustomRoomTypeMeta {
  key: string;
  name: string;
  shortName: string;
  inventory: number;
  priceMultiplier: number;
}

export interface CustomChannelMeta {
  key: string;
  name: string;
  shortName: string;
  basePrice: number;
  rackRate: number;
  commissionRate: number;
}

export interface BaseParams {
  totalRooms?: number;
  roomTypes?: Partial<Record<RoomTypeKey, { inventory?: number; priceMultiplier?: number }>>;
  channels?: Partial<Record<ChannelKey, { commissionRate?: number; basePrice?: number }>>;
  customRoomTypes?: CustomRoomTypeMeta[];
  customChannels?: CustomChannelMeta[];
}

export interface AppSettingsRow {
  id: string;
  current_week_key: string;
  submission_deadline: string | null;
  late_submit_deadline: string | null;
  base_params: BaseParams | null;
  benchmark_fiscal_year: number;
  benchmark_hotel_class: string;
  channel_sim: ChannelSimConfig | null;
  updated_at: string;
}

export interface MarketBenchmarkRow {
  section: string;
  metric: string;
  class: string;
  fiscal_year: number;
  value: number;
}

export interface ChannelBenchmarkRow {
  section: string;
  channel: string;
  hotel_class: string;
  fiscal_year: number;
  share: number;
}

export interface GuestSegmentBenchmarkRow {
  section: string;
  guest_type: string;
  hotel_class: string;
  fiscal_year: number;
  share: number;
}

export interface WeekSubmissionRow {
  id: string;
  group_id: string;
  week_key: string;
  submitted_at: string;
  submission_status: 'on_time' | 'late' | null;
}

export interface OpenWeekRow {
  id: string;
  week_key: string;
  opened_at: string;
  created_at: string;
}

export type WeekSubmissionStatus = 'on_time' | 'late' | 'not_submitted';

export interface DecisionRow {
  id: string;
  group_id: string;
  group_name: string;
  hotel_name: string;
  payload: DecisionPayload;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}
