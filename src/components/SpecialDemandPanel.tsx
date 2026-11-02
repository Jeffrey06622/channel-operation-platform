import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Copy, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { supabaseFetch, describeError } from '../supabaseRequest';
import { WEEKS, resolveChannels, resolveRoomTypes } from '../domain';
import {
  categoryLabel,
  describeScope,
  describeTrigger,
  expectedResponseLabel,
  factorKeyOf,
  registerActiveFactors,
} from '../specialDemand';
import SpecialDemandMatrix from './SpecialDemandMatrix';
import type {
  BaseParams,
  DecisionRow,
  GroupRow,
  SpecialDemandCategory,
  SpecialDemandExpected,
  SpecialDemandFactor,
  SpecialDemandScope,
  WeekMeta,
} from '../types';
import { cn } from '../utils';

interface Props {
  groups: GroupRow[];
  decisionMap: Map<string, DecisionRow>;
  baseParams: BaseParams | null;
  currentWeekKey: string;
}

type SubTab = 'maintain' | 'matrix';

const CATEGORY_OPTIONS: SpecialDemandCategory[] = ['event', 'holiday', 'weather', 'competition', 'policy', 'other'];
const EXPECTED_OPTIONS: SpecialDemandExpected[] = ['raise_price', 'expand_quota', 'shift_mix', 'hold_price', 'no_change'];
const SCOPE_OPTIONS: { value: SpecialDemandScope; label: string }[] = [
  { value: 'all', label: '全部房型与渠道' },
  { value: 'room_type', label: '指定房型' },
  { value: 'channel', label: '指定渠道' },
];

interface FactorDraft {
  name: string;
  category: SpecialDemandCategory;
  percent: string;
  description: string;
  scope_type: SpecialDemandScope;
  scope_keys: string[];
  expected_response: SpecialDemandExpected;
  threshold: string;
  effective_from: string;
  effective_to: string;
  student_selectable: boolean;
  is_active: boolean;
}

const EMPTY_DRAFT: FactorDraft = {
  name: '',
  category: 'event',
  percent: '10',
  description: '',
  scope_type: 'all',
  scope_keys: [],
  expected_response: 'raise_price',
  threshold: '5',
  effective_from: '',
  effective_to: '',
  student_selectable: true,
  is_active: true,
};

function draftFromFactor(f: SpecialDemandFactor): FactorDraft {
  return {
    name: f.name,
    category: f.category,
    percent: String(Math.round((f.demand_multiplier - 1) * 10000) / 100),
    description: f.description,
    scope_type: f.scope_type,
    scope_keys: f.scope_keys,
    expected_response: f.expected_response,
    threshold: String(f.threshold),
    effective_from: f.effective_from ?? '',
    effective_to: f.effective_to ?? '',
    student_selectable: f.student_selectable,
    is_active: f.is_active,
  };
}

function validateDraft(draft: FactorDraft, week: WeekMeta): string | null {
  const name = draft.name.trim();
  if (!name) return '请填写因素名称';
  if (name.length > 30) return '因素名称不超过 30 个字';
  if (draft.percent.trim() === '' || !Number.isFinite(Number(draft.percent))) return '请填写需求影响幅度';
  const percent = Number(draft.percent);
  if (percent === 0) return '影响幅度不能为 0';
  if (percent < -90 || percent > 200) return '影响幅度需在 -90% 到 +200% 之间';
  const threshold = Number(draft.threshold);
  if (draft.threshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0 || threshold > 200) {
    return '触发阈值需在 0 到 200 之间';
  }
  if (draft.scope_type !== 'all' && draft.scope_keys.length === 0) {
    return draft.scope_type === 'room_type' ? '请至少选择一个房型' : '请至少选择一个渠道';
  }
  if (draft.effective_from && draft.effective_to && draft.effective_from > draft.effective_to) {
    return '生效结束日期不能早于开始日期';
  }
  const overlaps =
    (!draft.effective_from || draft.effective_from <= week.endDate) &&
    (!draft.effective_to || draft.effective_to >= week.startDate);
  if (!overlaps) return `生效区间与所选周（${week.startDate} ~ ${week.endDate}）无交集`;
  if (draft.description.length > 200) return '说明不超过 200 个字';
  return null;
}

function draftToRow(draft: FactorDraft, weekKey: string, sortOrder: number) {
  const percent = Number(draft.percent);
  return {
    week_key: weekKey,
    name: draft.name.trim(),
    category: draft.category,
    direction: percent > 0 ? ('increase' as const) : ('decrease' as const),
    magnitude: Math.abs(percent),
    demand_multiplier: Number((1 + percent / 100).toFixed(4)),
    description: draft.description.trim(),
    scope_type: draft.scope_type,
    scope_keys: draft.scope_type === 'all' ? [] : draft.scope_keys,
    expected_response: draft.expected_response,
    threshold: Number(draft.threshold),
    effective_from: draft.effective_from || null,
    effective_to: draft.effective_to || null,
    student_selectable: draft.student_selectable,
    is_active: draft.is_active,
    sort_order: sortOrder,
  };
}

function countReferences(factor: SpecialDemandFactor, decisions: DecisionRow[]): number {
  const key = factorKeyOf(factor);
  return decisions.filter((d) =>
    Object.values(d.payload?.weeks ?? {}).some((w) => w?.specialFactors?.includes(key)),
  ).length;
}

export default function SpecialDemandPanel({ groups, decisionMap, baseParams, currentWeekKey }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('maintain');
  const [weekKey, setWeekKey] = useState(currentWeekKey);
  const [factors, setFactors] = useState<SpecialDemandFactor[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadErrorDetail, setLoadErrorDetail] = useState('');
  const [drawer, setDrawer] = useState<{ factor: SpecialDemandFactor | null; week: WeekMeta } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ factor: SpecialDemandFactor; refs: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const week = WEEKS.find((w) => w.key === weekKey) ?? WEEKS[0];
  const weekIndex = WEEKS.findIndex((w) => w.key === weekKey);
  const decisions = useMemo(() => Array.from(decisionMap.values()), [decisionMap]);

  const loadFactors = useCallback(async () => {
    setLoadState('loading');
    try {
      const res = await supabaseFetch(() =>
        supabase.from('special_demand_factors').select('*').order('week_key').order('sort_order'),
      );
      if (res.error) {
        setLoadErrorDetail(describeError(res.error));
        setLoadState('error');
        return;
      }
      const rows = Array.isArray(res.data) ? (res.data as SpecialDemandFactor[]) : [];
      registerActiveFactors(rows);
      setFactors(rows);
      setLoadState('ready');
    } catch (err) {
      setLoadErrorDetail(describeError(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const weekFactors = useMemo(() => factors.filter((f) => f.week_key === weekKey), [factors, weekKey]);

  function openDrawer(factor: SpecialDemandFactor | null) {
    const selected = WEEKS.find((w) => w.key === weekKey) ?? WEEKS[0];
    setDrawer({ factor, week: selected });
  }

  async function handleSave(draft: FactorDraft, editing: SpecialDemandFactor | null, target: WeekMeta): Promise<string | null> {
    const error = validateDraft(draft, target);
    if (error) return error;
    setBusy(true);
    const now = new Date().toISOString();
    const targetCount = factors.filter((f) => f.week_key === target.key).length;
    const res = editing
      ? await supabase
          .from('special_demand_factors')
          .update({ ...draftToRow(draft, target.key, editing.sort_order), updated_at: now })
          .eq('id', editing.id)
      : await supabase
          .from('special_demand_factors')
          .insert(draftToRow(draft, target.key, targetCount + 1));
    setBusy(false);
    if (res.error) {
      console.error('special demand factor save failed', res.error);
      return '保存失败，请稍后重试';
    }
    setDrawer(null);
    setToast(editing ? '因素已更新' : '因素已添加');
    loadFactors();
    return null;
  }

  async function handleToggle(factor: SpecialDemandFactor) {
    const next = !factor.is_active;
    const optimistic = factors.map((f) => (f.id === factor.id ? { ...f, is_active: next } : f));
    setFactors(optimistic);
    const res = await supabase
      .from('special_demand_factors')
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq('id', factor.id);
    if (res.error) {
      console.error('special demand toggle failed', res.error);
      setFactors((prev) => prev.map((f) => (f.id === factor.id ? { ...f, is_active: factor.is_active } : f)));
      setToast('切换失败，已恢复原状态');
      return;
    }
    registerActiveFactors(optimistic);
    setToast(next ? '因素已启用' : '因素已停用');
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    const res = await supabase.from('special_demand_factors').delete().eq('id', deleteTarget.factor.id);
    setBusy(false);
    setDeleteTarget(null);
    if (res.error) {
      console.error('special demand factor delete failed', res.error);
      setToast('删除失败，请稍后重试');
      return;
    }
    setToast('因素已删除');
    loadFactors();
  }

  async function handleCopyLastWeek() {
    const prevWeek = WEEKS[weekIndex - 1];
    if (!prevWeek) return;
    const source = factors.filter((f) => f.week_key === prevWeek.key);
    if (source.length === 0) {
      setToast(`第${prevWeek.index}周没有可复制的因素`);
      return;
    }
    setBusy(true);
    const rows = source.map((f, i) => ({
      week_key: weekKey,
      name: f.name,
      category: f.category,
      direction: f.direction,
      magnitude: f.magnitude,
      demand_multiplier: f.demand_multiplier,
      description: f.description,
      scope_type: f.scope_type,
      scope_keys: f.scope_keys,
      expected_response: f.expected_response,
      threshold: f.threshold,
      effective_from: f.effective_from,
      effective_to: f.effective_to,
      student_selectable: f.student_selectable,
      is_active: f.is_active,
      sort_order: weekFactors.length + i + 1,
    }));
    const res = await supabase.from('special_demand_factors').insert(rows);
    setBusy(false);
    if (res.error) {
      console.error('special demand copy failed', res.error);
      setToast('复制失败，请稍后重试');
      return;
    }
    setToast(`已从第${prevWeek.index}周复制 ${source.length} 个因素`);
    loadFactors();
  }

  const prevWeekHasFactors = weekIndex > 0 && factors.some((f) => f.week_key === WEEKS[weekIndex - 1].key);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              ['maintain', '因素维护'],
              ['matrix', '应变矩阵'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                subTab === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={weekKey}
          onChange={(e) => setWeekKey(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        >
          {WEEKS.map((w) => (
            <option key={w.key} value={w.key}>
              第{w.index}周（{w.label}）
            </option>
          ))}
        </select>
      </div>

      {loadState === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          正在读取特殊需求因素…
        </div>
      )}

      {loadState === 'error' && (
        <div className="flex flex-col items-center gap-3 py-14 px-6 text-center">
          <AlertCircle className="w-8 h-8 text-rose-500" />
          <p className="text-sm font-medium text-slate-700">特殊需求因素加载失败</p>
          <p className="text-xs text-slate-500 max-w-md">{loadErrorDetail}</p>
          <button
            type="button"
            onClick={loadFactors}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            点击重试
          </button>
        </div>
      )}

      {loadState === 'ready' && subTab === 'maintain' && (
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              本周共 {weekFactors.length} 个因素，其中 {weekFactors.filter((f) => f.is_active).length} 个启用
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyLastWeek}
                disabled={busy || !prevWeekHasFactors || weekFactors.length > 0}
                title={weekFactors.length > 0 ? '本周已有因素' : prevWeekHasFactors ? '' : '上一周没有可复制的因素'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                复制上一周
              </button>
              <button
                type="button"
                onClick={() => openDrawer(null)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                新增因素
              </button>
            </div>
          </div>

          {weekFactors.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
              本周还没有特殊需求因素
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {weekFactors.map((f) => {
                const up = f.demand_multiplier >= 1;
                return (
                  <li key={f.id} className="flex flex-wrap items-center gap-4 px-4 py-3 bg-white">
                    <div className="flex-1 min-w-[220px]">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{f.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                          {categoryLabel(f.category)}
                        </span>
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            up ? 'text-emerald-600' : 'text-red-500',
                          )}
                        >
                          ×{f.demand_multiplier.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {describeScope(f, baseParams)}｜{expectedResponseLabel(f.expected_response)}｜{describeTrigger(f)}
                      </p>
                      {f.student_selectable && (
                        <span className="inline-block mt-1 text-[11px] text-sky-700">学生可勾选</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={f.is_active}
                        onClick={() => handleToggle(f)}
                        className={cn(
                          'relative w-9 h-5 rounded-full transition-colors',
                          f.is_active ? 'bg-emerald-500' : 'bg-slate-300',
                        )}
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                            f.is_active && 'translate-x-4',
                          )}
                        />
                      </button>
                      {f.is_active ? '启用' : '停用'}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openDrawer(f)}
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                        aria-label="编辑因素"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget({ factor: f, refs: countReferences(f, decisions) })}
                        className="p-2 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        aria-label="删除因素"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {loadState === 'ready' && subTab === 'matrix' && (
        <SpecialDemandMatrix
          factors={factors}
          week={week}
          groups={groups}
          decisionMap={decisionMap}
          baseParams={baseParams}
        />
      )}

      {drawer && (
        <FactorDrawer
          key={drawer.factor?.id ?? 'new'}
          week={drawer.week}
          baseParams={baseParams}
          editing={drawer.factor}
          busy={busy}
          onClose={() => setDrawer(null)}
          onSubmit={(draft) => handleSave(draft, drawer.factor, drawer.week)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-5">
            <h3 className="text-base font-semibold text-slate-800">删除「{deleteTarget.factor.name}」？</h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              删除后该因素不再出现在学生的勾选列表中。
              {deleteTarget.refs > 0
                ? ` 已有 ${deleteTarget.refs} 组在历史周勾选过它，删除后这些历史周的系数将无法还原；如只想暂时不用，建议改为停用。`
                : ' 目前没有小组勾选过它，历史数据不受影响。'}
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm hover:bg-rose-500 disabled:opacity-50"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

interface FactorDrawerProps {
  week: WeekMeta;
  baseParams: BaseParams | null;
  editing: SpecialDemandFactor | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: FactorDraft) => Promise<string | null>;
}

function FactorDrawer({ week, baseParams, editing, busy, onClose, onSubmit }: FactorDrawerProps) {
  const [draft, setDraft] = useState<FactorDraft>(() => (editing ? draftFromFactor(editing) : EMPTY_DRAFT));
  const [error, setError] = useState('');
  const rooms = useMemo(() => resolveRoomTypes(baseParams), [baseParams]);
  const channels = useMemo(() => resolveChannels(baseParams), [baseParams]);

  function patch(p: Partial<FactorDraft>) {
    setDraft((d) => ({ ...d, ...p }));
    setError('');
  }

  function toggleScopeKey(key: string) {
    setDraft((d) => ({
      ...d,
      scope_keys: d.scope_keys.includes(key) ? d.scope_keys.filter((k) => k !== key) : [...d.scope_keys, key],
    }));
    setError('');
  }

  const scopeOptions = draft.scope_type === 'room_type' ? rooms : draft.scope_type === 'channel' ? channels : [];
  const inputClass =
    'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400';

  async function submit() {
    const err = await onSubmit(draft);
    if (err) setError(err);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="w-full max-w-lg h-full bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-800">{editing ? '编辑特殊需求因素' : '新增特殊需求因素'}</h3>
            <p className="text-xs text-slate-500 mt-0.5">第{week.index}周（{week.label}）</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">因素名称</span>
            <input className={cn(inputClass, 'mt-1')} value={draft.name} maxLength={30} onChange={(e) => patch({ name: e.target.value })} placeholder="例如：本地车展" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">类别</span>
              <select className={cn(inputClass, 'mt-1')} value={draft.category} onChange={(e) => patch({ category: e.target.value as SpecialDemandCategory })}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">需求影响幅度（%）</span>
              <input type="number" step="1" className={cn(inputClass, 'mt-1')} value={draft.percent} onChange={(e) => patch({ percent: e.target.value })} />
              <span className="text-[11px] text-slate-400">填 18 表示需求 ×1.18</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">影响范围</span>
              <select
                className={cn(inputClass, 'mt-1')}
                value={draft.scope_type}
                onChange={(e) => patch({ scope_type: e.target.value as SpecialDemandScope, scope_keys: [] })}
              >
                {SCOPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">预期应对</span>
              <select className={cn(inputClass, 'mt-1')} value={draft.expected_response} onChange={(e) => patch({ expected_response: e.target.value as SpecialDemandExpected })}>
                {EXPECTED_OPTIONS.map((x) => (
                  <option key={x} value={x}>{expectedResponseLabel(x)}</option>
                ))}
              </select>
            </label>
          </div>

          {scopeOptions.length > 0 && (
            <div>
              <span className="text-xs font-medium text-slate-600">选择{draft.scope_type === 'room_type' ? '房型' : '渠道'}</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {scopeOptions.map((o) => {
                  const on = draft.scope_keys.includes(o.key);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => toggleScopeKey(o.key)}
                      className={cn(
                        'px-2.5 py-1 rounded-lg border text-xs transition-colors',
                        on ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {o.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-slate-600">触发阈值（%）</span>
            <input type="number" step="1" className={cn(inputClass, 'mt-1')} value={draft.threshold} onChange={(e) => patch({ threshold: e.target.value })} />
            <span className="text-[11px] text-slate-500">{describeTrigger({ expected_response: draft.expected_response, threshold: Number(draft.threshold) || 0 })}</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">生效开始（可空）</span>
              <input type="date" className={cn(inputClass, 'mt-1')} value={draft.effective_from} onChange={(e) => patch({ effective_from: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">生效结束（可空）</span>
              <input type="date" className={cn(inputClass, 'mt-1')} value={draft.effective_to} onChange={(e) => patch({ effective_to: e.target.value })} />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">说明（选填，200 字以内）</span>
            <textarea rows={3} maxLength={200} className={cn(inputClass, 'mt-1 resize-none')} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
          </label>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={draft.student_selectable} onChange={(e) => patch({ student_selectable: e.target.checked })} className="accent-amber-500" />
              允许学生在决策页勾选
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={draft.is_active} onChange={(e) => patch({ is_active: e.target.checked })} className="accent-amber-500" />
              启用（停用后不再生效）
            </label>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

