import { useState } from 'react';
import { Save, RotateCcw, Plus, Trash2, BedDouble, Radio } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { CHANNELS, ROOM_TYPES, TOTAL_ROOMS } from '../domain';
import type { BaseParams, CustomRoomTypeMeta, CustomChannelMeta } from '../types';
import { cn } from '../utils';

interface Props {
  settingsId: string;
  initial: BaseParams | null;
  onSaved: (params: BaseParams) => void;
}

function numInput(
  value: number,
  onChange: (v: number) => void,
  opts?: { min?: number; max?: number; step?: number; className?: string },
) {
  return (
    <input
      type="number"
      value={value}
      min={opts?.min ?? 0}
      max={opts?.max}
      step={opts?.step ?? 1}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        'w-24 px-2 py-1 border border-slate-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400',
        opts?.className,
      )}
    />
  );
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export default function BaseParamsPanel({ settingsId, initial, onSaved }: Props) {
  const [totalRooms, setTotalRooms] = useState(initial?.totalRooms ?? TOTAL_ROOMS);

  const [channelRates, setChannelRates] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const ch of CHANNELS) {
      m[ch.key] = Math.round(((initial?.channels?.[ch.key]?.commissionRate ?? ch.commissionRate) * 100) * 100) / 100;
    }
    return m;
  });

  const [channelBasePrices, setChannelBasePrices] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const ch of CHANNELS) {
      m[ch.key] = initial?.channels?.[ch.key]?.basePrice ?? ch.basePrice;
    }
    return m;
  });

  const [roomInventory, setRoomInventory] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const rt of ROOM_TYPES) {
      m[rt.key] = initial?.roomTypes?.[rt.key]?.inventory ?? rt.inventory;
    }
    return m;
  });

  const [customRoomTypes, setCustomRoomTypes] = useState<CustomRoomTypeMeta[]>(
    initial?.customRoomTypes ?? [],
  );
  const [customChannels, setCustomChannels] = useState<CustomChannelMeta[]>(
    initial?.customChannels ?? [],
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // New room type form
  const [newRtName, setNewRtName] = useState('');
  const [newRtInventory, setNewRtInventory] = useState(10);
  const [newRtMultiplier, setNewRtMultiplier] = useState(1.0);

  // New channel form
  const [newChName, setNewChName] = useState('');
  const [newChBasePrice, setNewChBasePrice] = useState(300);
  const [newChRackRate, setNewChRackRate] = useState(600);
  const [newChCommission, setNewChCommission] = useState(15);

  function handleReset() {
    setTotalRooms(TOTAL_ROOMS);
    const rates: Record<string, number> = {};
    const prices: Record<string, number> = {};
    for (const ch of CHANNELS) {
      rates[ch.key] = Math.round(ch.commissionRate * 100 * 100) / 100;
      prices[ch.key] = ch.basePrice;
    }
    setChannelRates(rates);
    setChannelBasePrices(prices);
    const inv: Record<string, number> = {};
    for (const rt of ROOM_TYPES) inv[rt.key] = rt.inventory;
    setRoomInventory(inv);
    setCustomRoomTypes([]);
    setCustomChannels([]);
  }

  function addCustomRoomType() {
    const name = newRtName.trim();
    if (!name) { setError('请填写房型名称'); return; }
    const key = slugify(name);
    if (ROOM_TYPES.some((rt) => rt.key === key) || customRoomTypes.some((rt) => rt.key === key)) {
      setError('该房型已存在');
      return;
    }
    setCustomRoomTypes((prev) => [...prev, {
      key,
      name,
      shortName: name.slice(0, 4),
      inventory: newRtInventory,
      priceMultiplier: newRtMultiplier,
    }]);
    setNewRtName('');
    setNewRtInventory(10);
    setNewRtMultiplier(1.0);
    setError('');
  }

  function removeCustomRoomType(key: string) {
    setCustomRoomTypes((prev) => prev.filter((rt) => rt.key !== key));
  }

  function addCustomChannel() {
    const name = newChName.trim();
    if (!name) { setError('请填写渠道名称'); return; }
    const key = slugify(name);
    if (CHANNELS.some((ch) => ch.key === key) || customChannels.some((ch) => ch.key === key)) {
      setError('该渠道已存在');
      return;
    }
    setCustomChannels((prev) => [...prev, {
      key,
      name,
      shortName: name.slice(0, 4),
      basePrice: newChBasePrice,
      rackRate: newChRackRate,
      commissionRate: newChCommission / 100,
    }]);
    setNewChName('');
    setNewChBasePrice(300);
    setNewChRackRate(600);
    setNewChCommission(15);
    setError('');
  }

  function removeCustomChannel(key: string) {
    setCustomChannels((prev) => prev.filter((ch) => ch.key !== key));
  }

  async function handleSave() {
    setError('');
    const allRoomTypeKeys = [...ROOM_TYPES.map((rt) => rt.key), ...customRoomTypes.map((rt) => rt.key)];
    const inventorySum = allRoomTypeKeys.reduce((s, k) => {
      if (ROOM_TYPES.some((rt) => rt.key === k)) return s + (roomInventory[k] ?? 0);
      const custom = customRoomTypes.find((rt) => rt.key === k);
      return s + (custom?.inventory ?? 0);
    }, 0);
    if (inventorySum > totalRooms) {
      setError(`各房型房量合计 ${inventorySum} 间超过总房量 ${totalRooms} 间`);
      return;
    }
    setSaving(true);
    const params: BaseParams = {
      totalRooms,
      channels: Object.fromEntries(
        CHANNELS.map((ch) => [
          ch.key,
          {
            commissionRate: Math.round(channelRates[ch.key] * 100) / 10000,
            basePrice: channelBasePrices[ch.key],
          },
        ]),
      ) as BaseParams['channels'],
      roomTypes: Object.fromEntries(
        ROOM_TYPES.map((rt) => [rt.key, { inventory: roomInventory[rt.key], priceMultiplier: rt.priceMultiplier }]),
      ) as BaseParams['roomTypes'],
      customRoomTypes,
      customChannels,
    };
    const { error: err } = await supabase
      .from('app_settings')
      .update({ base_params: params, updated_at: new Date().toISOString() })
      .eq('id', settingsId);
    if (err) {
      setError(err.message);
    } else {
      onSaved(params);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  const builtinInventorySum = ROOM_TYPES.reduce((s, rt) => s + (roomInventory[rt.key] ?? 0), 0);
  const customInventorySum = customRoomTypes.reduce((s, rt) => s + rt.inventory, 0);
  const inventorySum = builtinInventorySum + customInventorySum;

  return (
    <div className="space-y-6">
      {/* Total rooms */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">总房量设置</h3>
        <div className="flex items-center gap-4">
          <label className="text-sm text-slate-600 w-24">总房量（间）</label>
          {numInput(totalRooms, setTotalRooms, { min: 10, max: 9999 })}
          <span className="text-xs text-slate-400">原始默认值：{TOTAL_ROOMS} 间</span>
        </div>
      </div>

      {/* Room types */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-slate-500" />
            各房型房量
          </h3>
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              inventorySum > totalRooms
                ? 'bg-red-50 text-red-600 border border-red-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200',
            )}
          >
            合计 {inventorySum} / {totalRooms} 间
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">房型</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">默认房量</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">当前设置</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">价格系数</th>
                <th className="text-center px-4 py-2.5 font-medium text-slate-600 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROOM_TYPES.map((rt) => (
                <tr key={rt.key} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">{rt.name}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{rt.inventory} 间</td>
                  <td className="px-4 py-3 text-right">
                    {numInput(roomInventory[rt.key] ?? rt.inventory, (v) =>
                      setRoomInventory((prev) => ({ ...prev, [rt.key]: v })),
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-400">{rt.priceMultiplier.toFixed(1)}×</td>
                  <td className="px-4 py-3 text-center text-slate-300 text-xs">内置</td>
                </tr>
              ))}
              {customRoomTypes.map((rt) => (
                <tr key={rt.key} className="hover:bg-slate-50/50 bg-blue-50/30">
                  <td className="px-4 py-3 font-medium text-slate-700">{rt.name}</td>
                  <td className="px-4 py-3 text-right text-slate-400">—</td>
                  <td className="px-4 py-3 text-right">
                    {numInput(rt.inventory, (v) =>
                      setCustomRoomTypes((prev) =>
                        prev.map((r) => (r.key === rt.key ? { ...r, inventory: v } : r)),
                      ),
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {numInput(rt.priceMultiplier, (v) =>
                      setCustomRoomTypes((prev) =>
                        prev.map((r) => (r.key === rt.key ? { ...r, priceMultiplier: v } : r)),
                      ),
                      { min: 0.1, max: 10, step: 0.1 },
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => removeCustomRoomType(rt.key)}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      title="删除房型"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add room type */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">房型名称</label>
              <input
                type="text"
                value={newRtName}
                onChange={(e) => setNewRtName(e.target.value)}
                placeholder="如：行政套房"
                className="w-32 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">房量</label>
              {numInput(newRtInventory, setNewRtInventory, { min: 1, max: 999 })}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">价格系数</label>
              {numInput(newRtMultiplier, setNewRtMultiplier, { min: 0.1, max: 10, step: 0.1 })}
            </div>
            <button
              onClick={addCustomRoomType}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-100 transition"
            >
              <Plus className="w-4 h-4" />
              添加房型
            </button>
          </div>
        </div>
      </div>

      {/* Channels */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Radio className="w-4 h-4 text-slate-500" />
          渠道参数设置
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">渠道</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">默认佣金率</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">佣金率（%）</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">默认基准价</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">基准价（元）</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">门市价</th>
                <th className="text-center px-4 py-2.5 font-medium text-slate-600 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {CHANNELS.map((ch) => (
                <tr key={ch.key} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">{ch.name}</td>
                  <td className="px-4 py-3 text-right text-slate-400">
                    {(ch.commissionRate * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {numInput(channelRates[ch.key] ?? ch.commissionRate * 100, (v) =>
                      setChannelRates((prev) => ({ ...prev, [ch.key]: v })),
                      { min: 0, max: 100, step: 0.1 },
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-400">
                    ¥{ch.basePrice}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {numInput(channelBasePrices[ch.key] ?? ch.basePrice, (v) =>
                      setChannelBasePrices((prev) => ({ ...prev, [ch.key]: v })),
                      { min: 0, step: 10 },
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-400">¥{ch.rackRate}</td>
                  <td className="px-4 py-3 text-center text-slate-300 text-xs">内置</td>
                </tr>
              ))}
              {customChannels.map((ch) => (
                <tr key={ch.key} className="hover:bg-slate-50/50 bg-blue-50/30">
                  <td className="px-4 py-3 font-medium text-slate-700">{ch.name}</td>
                  <td className="px-4 py-3 text-right text-slate-400">—</td>
                  <td className="px-4 py-3 text-right">
                    {numInput(Math.round(ch.commissionRate * 100 * 100) / 100, (v) =>
                      setCustomChannels((prev) =>
                        prev.map((c) => (c.key === ch.key ? { ...c, commissionRate: v / 100 } : c)),
                      ),
                      { min: 0, max: 100, step: 0.1 },
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-400">—</td>
                  <td className="px-4 py-3 text-right">
                    {numInput(ch.basePrice, (v) =>
                      setCustomChannels((prev) =>
                        prev.map((c) => (c.key === ch.key ? { ...c, basePrice: v } : c)),
                      ),
                      { min: 0, step: 10 },
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {numInput(ch.rackRate, (v) =>
                      setCustomChannels((prev) =>
                        prev.map((c) => (c.key === ch.key ? { ...c, rackRate: v } : c)),
                      ),
                      { min: 0, step: 10 },
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => removeCustomChannel(ch.key)}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      title="删除渠道"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add channel */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">渠道名称</label>
              <input
                type="text"
                value={newChName}
                onChange={(e) => setNewChName(e.target.value)}
                placeholder="如：飞猪"
                className="w-32 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">基准价</label>
              {numInput(newChBasePrice, setNewChBasePrice, { min: 0, step: 10 })}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">门市价</label>
              {numInput(newChRackRate, setNewChRackRate, { min: 0, step: 10 })}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">佣金率(%)</label>
              {numInput(newChCommission, setNewChCommission, { min: 0, max: 100, step: 0.1 })}
            </div>
            <button
              onClick={addCustomChannel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-100 transition"
            >
              <Plus className="w-4 h-4" />
              添加渠道
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
        >
          <RotateCcw className="w-4 h-4" />
          恢复默认值
        </button>
        <button
          onClick={handleSave}
          disabled={saving || inventorySum > totalRooms}
          className="inline-flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition shadow-md shadow-amber-500/20 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : saved ? '已保存 ✓' : '保存设置'}
        </button>
      </div>
    </div>
  );
}
