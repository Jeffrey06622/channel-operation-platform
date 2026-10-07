import type {
  BaseParams,
  ChannelDecision,
  ChannelKey,
  ChannelMeta,
  ChannelSimConfig,
  ChannelSimParams,
  DecisionPayload,
  RoomTypeDecision,
  RoomTypeKey,
  RoomTypeMeta,
  SpecialFactorMeta,
  WeekDecision,
  WeekMeta,
} from './types';

export const TOTAL_ROOMS = 100;

export const ROOM_TYPES: RoomTypeMeta[] = [
  {
    key: 'superior',
    name: '高级房',
    shortName: '高级',
    inventory: 50,
    priceMultiplier: 1.0,
    description: '基础房型，50间，门市价基准',
  },
  {
    key: 'deluxe',
    name: '豪华房',
    shortName: '豪华',
    inventory: 40,
    priceMultiplier: 1.35,
    description: '升级房型，40间，门市价为高级房1.35倍',
  },
  {
    key: 'suite',
    name: '套房',
    shortName: '套房',
    inventory: 10,
    priceMultiplier: 2.2,
    description: '顶级房型，10间，门市价为高级房2.2倍',
  },
];

export const ROOM_TYPE_MAP: Record<RoomTypeKey, RoomTypeMeta> =
  ROOM_TYPES.reduce(
    (acc, r) => ({ ...acc, [r.key]: r }),
    {} as Record<RoomTypeKey, RoomTypeMeta>,
  );

export const CHANNELS: ChannelMeta[] = [
  {
    key: 'ctrip',
    name: '携程',
    shortName: '携程',
    icon: 'Plane',
    basePrice: 300,
    rackRate: 880,
    commissionRate: 0.15,
    description: 'OTA主力渠道，覆盖广，佣金15%',
  },
  {
    key: 'meituan',
    name: '美团',
    shortName: '美团',
    icon: 'Utensils',
    basePrice: 250,
    rackRate: 780,
    commissionRate: 0.12,
    description: '本地生活渠道，价格敏感客群，佣金12%',
  },
  {
    key: 'corporate',
    name: '企业协议客',
    shortName: '协议客',
    icon: 'Building2',
    basePrice: 360,
    rackRate: 900,
    commissionRate: 0.0,
    description: '企业协议客户，价格稳定，无佣金',
  },
  {
    key: 'direct',
    name: '散客直销',
    shortName: '直销',
    icon: 'User',
    basePrice: 400,
    rackRate: 980,
    commissionRate: 0.0,
    description: '上门/官网散客，无佣金，门市价最高',
  },
  {
    key: 'douyin',
    name: '抖音短视频',
    shortName: '抖音',
    icon: 'Video',
    basePrice: 280,
    rackRate: 820,
    commissionRate: 0.08,
    description: '内容种草引流，冲动消费，佣金8%',
  },
  {
    key: 'xhs',
    name: '小红书种草',
    shortName: '小红书',
    icon: 'BookOpen',
    basePrice: 290,
    rackRate: 850,
    commissionRate: 0.06,
    description: '内容种草转化，年轻客群，佣金6%',
  },
];

const START_DATE = new Date('2024-09-14');
const END_DATE = new Date('2024-12-14');

const PEAK_WEEKS: { match: (label: string) => boolean; tag: string }[] = [
  { match: (l) => l.includes('9/14'), tag: '中秋' },
  { match: (l) => l.includes('9/30') || l.includes('10/1'), tag: '国庆旺季' },
  { match: (l) => l.includes('12/14'), tag: '跨年旺季' },
];

function fmtDate(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export const WEEKS: WeekMeta[] = (() => {
  const list: WeekMeta[] = [];
  let cursor = new Date(START_DATE);
  let idx = 1;
  while (cursor < END_DATE) {
    const start = new Date(cursor);
    const end = addDays(cursor, 6);
    const weekEnd = end > END_DATE ? END_DATE : end;
    const days = Math.round(
      (weekEnd.getTime() - start.getTime()) / 86400000,
    ) + 1;
    const label = `${fmtDate(start)} - ${fmtDate(weekEnd)}`;
    const peak = PEAK_WEEKS.find((p) => p.match(label));
    list.push({
      key: `wk${idx}`,
      index: idx,
      label,
      startDate: start.toISOString().slice(0, 10),
      endDate: weekEnd.toISOString().slice(0, 10),
      days,
      isPeak: !!peak,
      peakTag: peak?.tag ?? '',
      baseOccupancy: peak ? 0.88 : 0.62,
    });
    cursor = addDays(end, 1);
    idx++;
  }
  return list;
})();

export const SPECIAL_FACTORS: SpecialFactorMeta[] = [
  {
    key: 'weather',
    name: '天气因素',
    demandMultiplier: 0.9,
    description: '恶劣天气导致需求下降10%',
  },
  {
    key: 'concert',
    name: '演唱会',
    demandMultiplier: 1.18,
    description: '大型演唱会带动需求上升18%',
  },
  {
    key: 'sports',
    name: '体育赛事',
    demandMultiplier: 1.12,
    description: '体育赛事带动需求上升12%',
  },
  {
    key: 'conference',
    name: '大型会议',
    demandMultiplier: 1.15,
    description: '大型会议带动需求上升15%',
  },
  {
    key: 'local_emergency',
    name: '本地突发事件管控',
    demandMultiplier: 0.88,
    description: '突发事件管控导致需求下降12%',
  },
  {
    key: 'ota_promotion',
    name: 'OTA平台促销',
    demandMultiplier: 1.08,
    description: 'OTA平台促销活动带动需求上升8%',
  },
  {
    key: 'competitor_opening',
    name: '竞品酒店开业促销',
    demandMultiplier: 0.93,
    description: '周边竞品开业促销导致需求下降7%',
  },
];

export const DEFAULT_CHANNEL_SIM: ChannelSimConfig = {
  priceSensitivity: 0.5,
  channels: {
    ctrip: {
      baseConversionRate: 0.90,
      trafficCap: 0.18,
      currentWeekConfirmRate: 1.0,
      longTailReleases: [],
      coldStartWeeks: 0,
      coldStartDiscount: 1.0,
      weeklyFixedCost: 0,
      perRoomNightCost: 0,
      viralProbability: 0,
      viralMultiplier: 1.0,
      viralCapRelax: 0,
      impressionMultiplier: 1.0,
      baseClickRate: 0.35,
    },
    meituan: {
      baseConversionRate: 0.88,
      trafficCap: 0.12,
      currentWeekConfirmRate: 1.0,
      longTailReleases: [],
      coldStartWeeks: 0,
      coldStartDiscount: 1.0,
      weeklyFixedCost: 0,
      perRoomNightCost: 0,
      viralProbability: 0,
      viralMultiplier: 1.0,
      viralCapRelax: 0,
      impressionMultiplier: 1.0,
      baseClickRate: 0.32,
    },
    corporate: {
      baseConversionRate: 0.95,
      trafficCap: 0.32,
      currentWeekConfirmRate: 1.0,
      longTailReleases: [],
      coldStartWeeks: 0,
      coldStartDiscount: 1.0,
      weeklyFixedCost: 0,
      perRoomNightCost: 0,
      viralProbability: 0,
      viralMultiplier: 1.0,
      viralCapRelax: 0,
      impressionMultiplier: 0.5,
      baseClickRate: 0.60,
    },
    direct: {
      baseConversionRate: 0.55,
      trafficCap: 0.15,
      currentWeekConfirmRate: 1.0,
      longTailReleases: [],
      coldStartWeeks: 0,
      coldStartDiscount: 1.0,
      weeklyFixedCost: 0,
      perRoomNightCost: 0,
      viralProbability: 0,
      viralMultiplier: 1.0,
      viralCapRelax: 0,
      impressionMultiplier: 0.4,
      baseClickRate: 0.45,
    },
    douyin: {
      baseConversionRate: 0.25,
      trafficCap: 0.025,
      currentWeekConfirmRate: 0.75,
      longTailReleases: [{ offset: 1, rate: 0.25 }],
      coldStartWeeks: 0,
      coldStartDiscount: 1.0,
      weeklyFixedCost: 500,
      perRoomNightCost: 20,
      viralProbability: 0.08,
      viralMultiplier: 2.5,
      viralCapRelax: 0.0025,
      impressionMultiplier: 3.0,
      baseClickRate: 0.08,
    },
    xhs: {
      baseConversionRate: 0.09,
      trafficCap: 0.02,
      currentWeekConfirmRate: 0.35,
      longTailReleases: [
        { offset: 1, rate: 0.30 },
        { offset: 2, rate: 0.20 },
        { offset: 3, rate: 0.15 },
      ],
      coldStartWeeks: 2,
      coldStartDiscount: 0.5,
      weeklyFixedCost: 400,
      perRoomNightCost: 15,
      viralProbability: 0.10,
      viralMultiplier: 2.5,
      viralCapRelax: 0.02,
      impressionMultiplier: 4.0,
      baseClickRate: 0.06,
    },
  },
};

export function resolveChannelSim(
  overrides?: ChannelSimConfig | null,
): ChannelSimConfig {
  if (!overrides) return DEFAULT_CHANNEL_SIM;
  return {
    priceSensitivity: overrides.priceSensitivity ?? DEFAULT_CHANNEL_SIM.priceSensitivity,
    channels: { ...DEFAULT_CHANNEL_SIM.channels, ...overrides.channels },
  };
}

export function resolveChannelSimParams(
  channelKey: string,
  config?: ChannelSimConfig | null,
): ChannelSimParams {
  const resolved = resolveChannelSim(config);
  return (
    resolved.channels[channelKey] ?? {
      baseConversionRate: 0.5,
      trafficCap: 0.10,
      currentWeekConfirmRate: 1.0,
      longTailReleases: [],
      coldStartWeeks: 0,
      coldStartDiscount: 1.0,
      weeklyFixedCost: 0,
      perRoomNightCost: 0,
      viralProbability: 0,
      viralMultiplier: 1.0,
      viralCapRelax: 0,
      impressionMultiplier: 1.0,
      baseClickRate: 0.20,
    }
  );
}

export const CHANNEL_MAP: Record<ChannelKey, ChannelMeta> = CHANNELS.reduce(
  (acc, c) => ({ ...acc, [c.key]: c }),
  {} as Record<ChannelKey, ChannelMeta>,
);

export const WEEK_MAP: Record<string, WeekMeta> = WEEKS.reduce(
  (acc, w) => ({ ...acc, [w.key]: w }),
  {} as Record<string, WeekMeta>,
);

export const SPECIAL_FACTOR_MAP: Record<string, SpecialFactorMeta> =
  SPECIAL_FACTORS.reduce(
    (acc, f) => ({ ...acc, [f.key]: f }),
    {} as Record<string, SpecialFactorMeta>,
  );

export function priceMin(
  channelKey: ChannelKey,
  roomTypeKey: RoomTypeKey,
  overrides?: BaseParams | null,
): number {
  const channels = resolveChannels(overrides);
  const roomTypes = resolveRoomTypes(overrides);
  const ch = channels.find((c) => c.key === channelKey);
  const rt = roomTypes.find((r) => r.key === roomTypeKey);
  if (!ch || !rt) return 0;
  return Math.round(ch.basePrice * rt.priceMultiplier);
}

export function priceMax(
  channelKey: ChannelKey,
  roomTypeKey: RoomTypeKey,
  overrides?: BaseParams | null,
): number {
  const channels = resolveChannels(overrides);
  const roomTypes = resolveRoomTypes(overrides);
  const ch = channels.find((c) => c.key === channelKey);
  const rt = roomTypes.find((r) => r.key === roomTypeKey);
  if (!ch || !rt) return 0;
  return Math.round(ch.rackRate * rt.priceMultiplier * 2);
}

function emptyRoomTypeDecision(): RoomTypeDecision {
  return {
    price: null,
    quota: null,
    weekend_pricing_enabled: false,
    weekend_days: [5, 6],
    weekday_price: null,
    weekend_price: null,
  };
}

export function emptyChannelDecision(roomTypes?: RoomTypeMeta[]): ChannelDecision {
  const list = roomTypes ?? ROOM_TYPES;
  const rt = {} as Record<RoomTypeKey, RoomTypeDecision>;
  for (const r of list) {
    rt[r.key] = emptyRoomTypeDecision();
  }
  return { roomTypes: rt };
}

export function emptyWeekDecision(
  channels?: ChannelMeta[],
  roomTypes?: RoomTypeMeta[],
): WeekDecision {
  const list = channels ?? CHANNELS;
  const ch = {} as Record<ChannelKey, ChannelDecision>;
  for (const c of list) {
    ch[c.key] = emptyChannelDecision(roomTypes);
  }
  return { channels: ch, specialFactors: [] };
}

export function emptyDecisionPayload(
  channels?: ChannelMeta[],
  roomTypes?: RoomTypeMeta[],
): DecisionPayload {
  const weeks = {} as Record<string, WeekDecision>;
  for (const w of WEEKS) {
    weeks[w.key] = emptyWeekDecision(channels, roomTypes);
  }
  return { weeks };
}

export function resolveTotalRooms(overrides?: BaseParams | null): number {
  return overrides?.totalRooms ?? TOTAL_ROOMS;
}

export function resolveRoomTypes(overrides?: BaseParams | null): RoomTypeMeta[] {
  const base = ROOM_TYPES.map((rt) => {
    const ov = overrides?.roomTypes?.[rt.key];
    return ov ? { ...rt, ...ov } : rt;
  });
  const customList = overrides?.customRoomTypes ?? [];
  const customMetas: RoomTypeMeta[] = customList.map((c) => ({
    key: c.key,
    name: c.name,
    shortName: c.shortName || c.name,
    inventory: c.inventory,
    priceMultiplier: c.priceMultiplier,
    description: '',
  }));
  return [...base, ...customMetas];
}

export function resolveChannels(overrides?: BaseParams | null): ChannelMeta[] {
  const base = CHANNELS.map((ch) => {
    const ov = overrides?.channels?.[ch.key];
    return ov ? { ...ch, ...ov } : ch;
  });
  const customList = overrides?.customChannels ?? [];
  const customMetas: ChannelMeta[] = customList.map((c) => ({
    key: c.key,
    name: c.name,
    shortName: c.shortName || c.name,
    icon: 'Plus',
    basePrice: c.basePrice,
    rackRate: c.rackRate,
    commissionRate: c.commissionRate,
    description: '',
  }));
  return [...base, ...customMetas];
}
