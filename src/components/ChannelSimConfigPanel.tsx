import { useState } from 'react';
import { Settings2, Save, RotateCcw, TrendingUp, Eye, DollarSign, Sparkles } from 'lucide-react';
import type { ChannelSimConfig, ChannelSimParams } from '../types';
import { DEFAULT_CHANNEL_SIM, resolveChannelSim } from '../domain';
import { supabase } from '../supabaseClient';
import { cn } from '../utils';

interface Props {
  settingsId: string;
  initial: ChannelSimConfig | null;
  onSaved: (config: ChannelSimConfig) => void;
}

const CHANNEL_LABELS: Record<string, string> = {
  ctrip: '携程',
  meituan: '美团',
  corporate: '企业协议',
  direct: '散客直销',
  douyin: '抖音',
  xhs: '小红书',
};

const PARAM_FIELDS: { key: keyof ChannelSimParams; label: string; step: string; icon: typeof TrendingUp; group: string }[] = [
  { key: 'baseConversionRate', label: '基础转化率', step: '0.01', icon: TrendingUp, group: '转化' },
  { key: 'trafficCap', label: '流量上限占比', step: '0.01', icon: Eye, group: '流量' },
  { key: 'currentWeekConfirmRate', label: '当周确认率', step: '0.05', icon: TrendingUp, group: '长尾' },
  { key: 'coldStartWeeks', label: '冷启动周数', step: '1', icon: Sparkles, group: '长尾' },
  { key: 'coldStartDiscount', label: '冷启动折扣', step: '0.05', icon: TrendingUp, group: '长尾' },
  { key: 'weeklyFixedCost', label: '周固定内容成本', step: '50', icon: DollarSign, group: '成本' },
  { key: 'perRoomNightCost', label: '每间夜投流成本', step: '1', icon: DollarSign, group: '成本' },
  { key: 'viralProbability', label: '爆款概率', step: '0.01', icon: Sparkles, group: '爆款' },
  { key: 'viralMultiplier', label: '爆款转化倍数', step: '0.1', icon: TrendingUp, group: '爆款' },
  { key: 'viralCapRelax', label: '爆款流量上限放宽', step: '0.005', icon: Eye, group: '爆款' },
  { key: 'impressionMultiplier', label: '曝光倍数', step: '0.5', icon: Eye, group: '曝光' },
  { key: 'baseClickRate', label: '基础点击率', step: '0.01', icon: Eye, group: '曝光' },
];

export default function ChannelSimConfigPanel({ settingsId, initial, onSaved }: Props) {
  const resolved = resolveChannelSim(initial);
  const [config, setConfig] = useState<ChannelSimConfig>(resolved);
  const [saving, setSaving] = useState(false);
  const [expandedChannel, setExpandedChannel] = useState<string | null>('xhs');

  function updateParam(channelKey: string, field: keyof ChannelSimParams, value: number) {
    setConfig((prev) => ({
      ...prev,
      channels: {
        ...prev.channels,
        [channelKey]: {
          ...prev.channels[channelKey],
          [field]: value,
        },
      },
    }));
  }

  function updatePriceSensitivity(value: number) {
    setConfig((prev) => ({ ...prev, priceSensitivity: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('app_settings')
        .update({ channel_sim: config, updated_at: new Date().toISOString() })
        .eq('id', settingsId);
      if (error) throw error;
      onSaved(config);
    } catch {
      // ignore
    }
    setSaving(false);
  }

  function handleReset() {
    setConfig(DEFAULT_CHANNEL_SIM);
  }

  const channelKeys = Object.keys(config.channels);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-700">渠道成交算法参数</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            恢复默认
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition disabled:opacity-40"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? '保存中...' : '保存参数'}
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Global price sensitivity */}
        <div className="flex items-center gap-4 p-3 bg-amber-50/50 border border-amber-100 rounded-lg">
          <label className="text-sm font-medium text-slate-700 whitespace-nowrap">价格敏感度系数</label>
          <input
            type="number"
            step="0.05"
            min="0"
            max="2"
            value={config.priceSensitivity}
            onChange={(e) => updatePriceSensitivity(Number(e.target.value))}
            className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          />
          <span className="text-xs text-slate-400">越高表示价格偏离基准对转化率影响越大</span>
        </div>

        {/* Per-channel config */}
        <div className="space-y-2">
          {channelKeys.map((chKey) => {
            const params = config.channels[chKey];
            const isExpanded = expandedChannel === chKey;
            const label = CHANNEL_LABELS[chKey] ?? chKey;
            return (
              <div key={chKey} className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedChannel(isExpanded ? null : chKey)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition"
                >
                  <span className="text-sm font-medium text-slate-700">{label}</span>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>转化率 {(params.baseConversionRate * 100).toFixed(0)}%</span>
                    <span>流量上限 {(params.trafficCap * 100).toFixed(1)}%</span>
                    {params.weeklyFixedCost > 0 && <span>内容成本 ¥{params.weeklyFixedCost}/周</span>}
                    <span className={cn('transition-transform', isExpanded && 'rotate-180')}>▾</span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 bg-slate-50/50">
                    {PARAM_FIELDS.map(({ key, label: fieldLabel, step, icon: Icon }) => (
                      <div key={key} className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Icon className="w-3 h-3 text-slate-400" />
                          {fieldLabel}
                        </label>
                        <input
                          type="number"
                          step={step}
                          min="0"
                          value={params[key] as number}
                          onChange={(e) => updateParam(chKey, key, Number(e.target.value))}
                          className="px-2 py-1 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 bg-white"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-slate-400">
          所有参数修改保存后立即生效，学生预览、教师面板、Excel导出均使用同一套计算逻辑。排名以净贡献（毛营收 - 佣金 - 内容投流成本）排序。
        </p>
      </div>
    </div>
  );
}
