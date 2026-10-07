import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Hotel,
  LogOut,
  Download,
  Users,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  Clock,
  XCircle,
  Search,
  ChevronRight,
  ChevronLeft,
  Lock,
  Unlock,
  Trophy,
  Filter,
  KeyRound,
  Settings,
  Calendar,
  AlertTriangle,
  RotateCcw,
  CheckSquare,
  Square,
  Zap,
  X as XIcon,
  CalendarClock,
  Flame,
  BarChart3,
  ShieldAlert,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { supabaseFetch, isNetworkError } from '../supabaseRequest';
import { hashPassword, verifyTeacherPassword } from '../auth';
import type { AppSettingsRow, BaseParams, ChannelKey, ChannelSimConfig, DecisionPayload, DecisionRow, GroupRow, OpenWeekRow, RoomTypeKey, WeekSubmissionRow } from '../types';
import { WEEKS, resolveRoomTypes } from '../domain';
import { computeCycle } from '../calc';
import { buildExportRows, rowsToCsv, downloadCsv } from '../export';
import { cn, fmtMoney, fmtPct, fmtNum } from '../utils';
import ResultsPanel from './ResultsPanel';
import BaseParamsPanel from './BaseParamsPanel';
import ChannelSimConfigPanel from './ChannelSimConfigPanel';
import MarketEnvironmentTab from './MarketEnvironmentTab';

const CLASS_OPTIONS = ['酒管25088', '酒管25089', '酒管25090', '酒管25091'];

type Tab = 'groups' | 'params' | 'deadline' | 'market';

interface Props {
  onLogout: () => void;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-400 text-white text-xs font-bold shadow-sm">
        1
      </span>
    );
  if (rank === 2)
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-400 text-white text-xs font-bold shadow-sm">
        2
      </span>
    );
  if (rank === 3)
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-700 text-white text-xs font-bold shadow-sm">
        3
      </span>
    );
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold">
      {rank}
    </span>
  );
}

export default function TeacherDashboard({ onLogout }: Props) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [weekSubmissions, setWeekSubmissions] = useState<WeekSubmissionRow[]>([]);
  const [openWeeks, setOpenWeeks] = useState<OpenWeekRow[]>([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [settingsId, setSettingsId] = useState<string>('');
  const [currentWeekKey, setCurrentWeekKey] = useState<string>('wk1');
  const [baseParams, setBaseParams] = useState<BaseParams | null>(null);
  const [channelSim, setChannelSim] = useState<ChannelSimConfig | null>(null);
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);
  const [lateSubmitDeadline, setLateSubmitDeadline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekChanging, setWeekChanging] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showBatchCreate, setShowBatchCreate] = useState(false);
  const [viewingGroup, setViewingGroup] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [toast, setToast] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('groups');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [benchmarkFiscalYear, setBenchmarkFiscalYear] = useState(2025);
  const [benchmarkHotelClass, setBenchmarkHotelClass] = useState('五星');

  const [healthCheckResults, setHealthCheckResults] = useState<Array<{
    groupId: string;
    groupName: string;
    classLabel: string;
    weekKey: string;
    issue: string;
  }> | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [gRes, dRes, subRes, settingsRes, openRes] = await Promise.all([
        supabaseFetch(() => supabase.from('groups').select('*').order('name')),
        supabaseFetch(() => supabase.from('decisions').select('*').order('group_name')),
        supabaseFetch(() => supabase.from('week_submissions').select('*')),
        supabaseFetch(() => supabase.from('app_settings').select('*').maybeSingle()),
        supabaseFetch(() => supabase.from('open_weeks').select('*').order('opened_at')),
      ]);
      setGroups((gRes.data as GroupRow[]) || []);
      setDecisions((dRes.data as DecisionRow[]) || []);
      setWeekSubmissions((subRes.data as WeekSubmissionRow[]) || []);
      setOpenWeeks((openRes.data as OpenWeekRow[]) || []);
      if (settingsRes.data) {
        const s = settingsRes.data as AppSettingsRow;
        setSettingsId(s.id);
        setCurrentWeekKey(s.current_week_key);
        setBaseParams(s.base_params ?? null);
        setChannelSim(s.channel_sim ?? null);
        setSubmissionDeadline(s.submission_deadline ?? null);
        setLateSubmitDeadline(s.late_submit_deadline ?? null);
        setBenchmarkFiscalYear(s.benchmark_fiscal_year ?? 2025);
        setBenchmarkHotelClass(s.benchmark_hotel_class ?? '五星');
      }
    } catch (err) {
      setToast(isNetworkError(err) ? '网络不佳，加载失败，请重试' : '数据加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Clear selection when groups list changes
  useEffect(() => {
    setSelectedGroupIds(new Set());
  }, [groups]);

  const openWeekKeys = useMemo(() => new Set(openWeeks.map((w) => w.week_key)), [openWeeks]);

  async function handleOpenWeeks(weekKeys: string[]) {
    if (weekKeys.length === 0) return;
    setWeekChanging(true);
    const existing = openWeekKeys;
    const toAdd = weekKeys.filter((k) => !existing.has(k));
    if (toAdd.length > 0) {
      const rows = toAdd.map((k) => ({ week_key: k }));
      const { error } = await supabase.from('open_weeks').insert(rows);
      if (error) { setToast('开放失败：' + error.message); setWeekChanging(false); return; }
    }
    await loadData();
    setToast(`已开放 ${weekKeys.length} 个周次`);
    setWeekChanging(false);
  }

  async function handleCloseWeeks(weekKeys: string[]) {
    if (weekKeys.length === 0) return;
    setWeekChanging(true);
    const { error } = await supabase.from('open_weeks').delete().in('week_key', weekKeys);
    if (error) { setToast('关闭失败：' + error.message); setWeekChanging(false); return; }
    await loadData();
    setToast(`已关闭 ${weekKeys.length} 个周次`);
    setWeekChanging(false);
  }

  async function handleSetWeek(weekKey: string) {
    setWeekChanging(true);
    const { error } = await supabase
      .from('app_settings')
      .update({ current_week_key: weekKey, updated_at: new Date().toISOString() })
      .eq('id', settingsId);
    if (error) {
      setToast('切换失败：' + error.message);
    } else {
      setCurrentWeekKey(weekKey);
      setToast(`已设当前周为第${WEEKS.find((w) => w.key === weekKey)?.index}周`);
    }
    setWeekChanging(false);
  }

  function handleExport() {
    if (groups.length === 0) {
      setToast('暂无可导出的数据');
      return;
    }
    const rows = buildExportRows(groups, decisions, baseParams, weekSubmissions, channelSim);
    const csv = rowsToCsv(rows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`小组收益总排名_${date}.csv`, csv);
    setToast('已导出 Excel/CSV 文件');
  }

  // Full backup: exports all groups' raw decision payloads + week submissions as JSON.
  // Recommended before opening each new week.
  function handleBackupExport() {
    if (groups.length === 0) {
      setToast('暂无可备份的数据');
      return;
    }
    const backup = {
      exported_at: new Date().toISOString(),
      groups: groups.map((g) => {
        const d = decisions.find((dd) => dd.group_id === g.id);
        const subs = weekSubmissions.filter((s) => s.group_id === g.id);
        return {
          group_id: g.id,
          group_name: g.name,
          class_label: g.class_label,
          hotel_name: g.hotel_name,
          decision_id: d?.id ?? null,
          payload: d?.payload ?? null,
          status: d?.status ?? null,
          updated_at: d?.updated_at ?? null,
          submissions: subs.map((s) => ({
            week_key: s.week_key,
            submitted_at: s.submitted_at,
            submission_status: s.submission_status,
          })),
        };
      }),
    };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `全量备份_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast('已导出全量备份 JSON，请妥善保存');
  }

  // Restore a single group's decision payload from a backup JSON file.
  async function handleRestoreGroup(group: GroupRow) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const backup = JSON.parse(text);
        const entry = (backup.groups ?? []).find(
          (g: { group_id?: string; group_name?: string }) =>
            g.group_id === group.id || g.group_name === group.name,
        );
        if (!entry || !entry.payload) {
          setToast('备份文件中未找到该小组的数据');
          return;
        }
        if (!confirm(`确认恢复小组"${group.name}"的决策数据吗？\n这将用备份数据覆盖当前数据，操作不可撤销。`)) return;
        const { error } = await supabase
          .from('decisions')
          .upsert({
            group_id: group.id,
            group_name: group.name,
            hotel_name: entry.hotel_name ?? group.hotel_name,
            payload: entry.payload,
            status: entry.status ?? 'draft',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'group_id' });
        if (error) {
          setToast('恢复失败：' + error.message);
          return;
        }
        await loadData();
        setToast(`已恢复 ${group.name} 的决策数据`);
      } catch {
        setToast('文件解析失败，请选择正确的备份文件');
      }
    };
    input.click();
  }

  // Data health check: scans all groups for submitted weeks with empty/missing/malformed data.
  // Flags: submitted week but no payload, no week data in payload, all prices/quotas zero.
  async function handleHealthCheck() {
    setHealthChecking(true);
    try {
      const results: Array<{ groupId: string; groupName: string; classLabel: string; weekKey: string; issue: string }> = [];
      for (const g of groups) {
        const d = decisionMap.get(g.id);
        const subs = groupSubmittedWeeks.get(g.id) ?? new Set();
        for (const subWeek of subs) {
          if (!d) {
            results.push({ groupId: g.id, groupName: g.name, classLabel: g.class_label || '', weekKey: subWeek, issue: '已提交但无决策记录' });
            continue;
          }
          const payload = d.payload as DecisionPayload;
          if (!payload?.weeks?.[subWeek]) {
            results.push({ groupId: g.id, groupName: g.name, classLabel: g.class_label || '', weekKey: subWeek, issue: '已提交但 payload 中无该周数据' });
            continue;
          }
          const wd = payload.weeks[subWeek];
          if (!wd.channels) {
            results.push({ groupId: g.id, groupName: g.name, classLabel: g.class_label || '', weekKey: subWeek, issue: '该周 channels 字段缺失' });
            continue;
          }
          let hasData = false;
          for (const chKey of Object.keys(wd.channels)) {
            const ch = wd.channels[chKey as ChannelKey];
            if (!ch?.roomTypes) continue;
            for (const rtKey of Object.keys(ch.roomTypes)) {
              const rt = ch.roomTypes[rtKey as RoomTypeKey];
              if (!rt) continue;
              if ((rt.price ?? 0) > 0 || (rt.quota ?? 0) > 0 || (rt.weekday_price ?? 0) > 0 || (rt.weekend_price ?? 0) > 0) {
                hasData = true;
                break;
              }
            }
            if (hasData) break;
          }
          if (!hasData) {
            results.push({ groupId: g.id, groupName: g.name, classLabel: g.class_label || '', weekKey: subWeek, issue: '已提交但所有价格和配额均为空或零' });
          }
        }
      }
      setHealthCheckResults(results);
      setToast(results.length === 0 ? '数据健康检查通过，未发现问题' : `发现 ${results.length} 个数据问题`);
    } catch (err) {
      setToast(isNetworkError(err) ? '网络不佳，检查失败' : '数据健康检查失败');
    }
    setHealthChecking(false);
  }

  async function handleResetWeek(group: GroupRow, weekKey: string) {
    const weekMeta = WEEKS.find((w) => w.key === weekKey);
    if (!confirm(`确定退回小组"${group.name}"的第${weekMeta?.index}周提交吗？\n退回后该小组可重新修改并提交本周决策。`)) return;
    const { error } = await supabase
      .from('week_submissions')
      .delete()
      .eq('group_id', group.id)
      .eq('week_key', weekKey);
    if (error) { setToast('退回失败：' + error.message); return; }
    await loadData();
    setToast(`已退回 ${group.name} 的第${weekMeta?.index}周提交`);
  }

  async function handleResetPassword(group: GroupRow) {
    if (!confirm(`确定将小组"${group.name}"的密码重置为 000000 吗？`)) return;
    try {
      const hash = await hashPassword('000000');
      const result = await supabaseFetch(() =>
        supabase
          .from('groups')
          .update({ password_hash: hash, password_plain: '000000' })
          .eq('id', group.id),
      );
      if (result.error) { setToast('重置失败：' + result.error.message); return; }
      await loadData();
      setToast(`已重置 ${group.name} 的密码为 000000`);
    } catch (err) {
      setToast(isNetworkError(err) ? '网络不佳，请检查网络后重试' : '重置失败');
    }
  }

  async function handleDeleteGroup(group: GroupRow) {
    if (!confirm(`确定删除小组"${group.name}"及其所有决策数据吗？此操作不可撤销。`)) return;
    await supabase.from('groups').delete().eq('id', group.id);
    await loadData();
    setToast('已删除小组');
  }

  async function handleBatchDelete() {
    if (selectedGroupIds.size === 0) return;
    const names = groups
      .filter((g) => selectedGroupIds.has(g.id))
      .map((g) => g.name)
      .join('、');
    if (!confirm(`确定删除以下 ${selectedGroupIds.size} 个小组及其所有决策数据吗？\n\n${names}\n\n此操作不可撤销。`))
      return;
    await supabase.from('groups').delete().in('id', [...selectedGroupIds]);
    await loadData();
    setToast(`已删除 ${selectedGroupIds.size} 个小组`);
    setSelectedGroupIds(new Set());
  }

  async function handleBatchResetPassword() {
    if (selectedGroupIds.size === 0) return;
    const names = groups
      .filter((g) => selectedGroupIds.has(g.id))
      .map((g) => g.name)
      .join('、');
    if (!confirm(`确定将以下 ${selectedGroupIds.size} 个小组的密码重置为 000000 吗？\n\n${names}`)) return;
    const hash = await hashPassword('000000');
    await supabase
      .from('groups')
      .update({ password_hash: hash, password_plain: '000000' })
      .in('id', [...selectedGroupIds]);
    await loadData();
    setToast(`已重置 ${selectedGroupIds.size} 个小组的密码`);
  }

  function toggleSelectGroup(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedGroupIds.size === filteredGroups.length) {
      setSelectedGroupIds(new Set());
    } else {
      setSelectedGroupIds(new Set(filteredGroups.map((g) => g.id)));
    }
  }

  const decisionMap = useMemo(() => {
    const m = new Map<string, DecisionRow>();
    for (const d of decisions) m.set(d.group_id, d);
    return m;
  }, [decisions]);

  const groupSubmittedWeeks = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const sub of weekSubmissions) {
      if (!m.has(sub.group_id)) m.set(sub.group_id, new Set());
      m.get(sub.group_id)!.add(sub.week_key);
    }
    return m;
  }, [weekSubmissions]);

  const netRevenueMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) {
      const d = decisionMap.get(g.id);
      m.set(g.id, d ? computeCycle(d.payload, baseParams, channelSim, g.id).totalNetContribution : -Infinity);
    }
    return m;
  }, [groups, decisionMap, baseParams, channelSim]);

  const rankMap = useMemo(() => {
    const sorted = [...groups].sort(
      (a, b) => (netRevenueMap.get(b.id) ?? -Infinity) - (netRevenueMap.get(a.id) ?? -Infinity),
    );
    const m = new Map<string, number>();
    sorted.forEach((g, i) => m.set(g.id, i + 1));
    return m;
  }, [groups, netRevenueMap]);

  const filteredGroups = useMemo(
    () =>
      groups
        .filter((g) => {
          const matchClass = classFilter ? g.class_label === classFilter : true;
          const matchSearch = search
            ? g.name.toLowerCase().includes(search.toLowerCase()) ||
              g.class_label.toLowerCase().includes(search.toLowerCase())
            : true;
          return matchClass && matchSearch;
        })
        .sort(
          (a, b) =>
            (netRevenueMap.get(b.id) ?? -Infinity) - (netRevenueMap.get(a.id) ?? -Infinity),
        ),
    [groups, classFilter, search, netRevenueMap],
  );

  const currentWeekMeta = WEEKS.find((w) => w.key === currentWeekKey);
  const currentWeekIndex = WEEKS.findIndex((w) => w.key === currentWeekKey);
  const submittedCurrentWeekCount = weekSubmissions.filter((s) => s.week_key === currentWeekKey).length;

  const isDeadlinePassed = submissionDeadline ? new Date() > new Date(submissionDeadline) : false;

  const viewingDecision = viewingGroup ? decisionMap.get(viewingGroup) : null;

  if (viewingDecision) {
    const cycle = computeCycle(viewingDecision.payload, baseParams, channelSim, viewingDecision.group_id);
    const viewingGroupSubs = groupSubmittedWeeks.get(viewingDecision.group_id) ?? new Set();
    const viewingRank = rankMap.get(viewingDecision.group_id) ?? '-';
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <button
              onClick={() => setViewingGroup(null)}
              className="text-sm text-slate-600 hover:text-slate-800 flex items-center gap-1"
            >
              ← 返回列表
            </button>
            <div className="flex items-center gap-3 text-sm text-slate-500 truncate">
              <span>
                {(() => {
                  const g = groups.find((x) => x.id === viewingDecision.group_id);
                  return g?.class_label ? `${g.class_label} · ` : '';
                })()}
                {viewingDecision.group_name} · {viewingDecision.hotel_name}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-semibold flex-shrink-0">
                <Trophy className="w-3 h-3" />
                竞争圈第 {viewingRank} 名
              </span>
            </div>
          </div>
        </header>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 shadow-sm">
            <div className="text-sm font-semibold text-slate-700 mb-3">各周提交状态</div>
            <div className="flex flex-wrap gap-2">
              {WEEKS.map((w) => {
                const submitted = viewingGroupSubs.has(w.key);
                return (
                  <span
                    key={w.key}
                    className={cn(
                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium',
                      submitted
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : w.key === currentWeekKey
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-slate-50 text-slate-400 border border-slate-200',
                    )}
                  >
                    {submitted ? <Lock className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                    第{w.index}周
                  </span>
                );
              })}
            </div>
          </div>
          <ResultsPanel result={cycle} roomTypes={resolveRoomTypes(baseParams)} />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
          <div className="text-slate-400 text-sm">正在连接服务器...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <Hotel className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-800">教师管理后台</h1>
              <p className="text-xs text-slate-500">酒店渠道运营决策实训平台</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChangePassword(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
            >
              <KeyRound className="w-4 h-4" />
              修改密码
            </button>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
              退出
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 border-t border-slate-100">
          <div className="flex gap-1 -mb-px">
            {(
              [
                { key: 'groups', label: '小组管理', icon: Users },
                { key: 'params', label: '基础参数', icon: Settings },
                { key: 'deadline', label: '提交控制', icon: Calendar },
                { key: 'market', label: '市场环境数据', icon: BarChart3 },
              ] as { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[]
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition',
                  activeTab === key
                    ? 'border-amber-500 text-amber-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {key === 'deadline' && isDeadlinePassed && (
                  <span className="w-2 h-2 rounded-full bg-red-500 ml-0.5" />
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'groups' && (
          <GroupsTab
            groups={groups}
            filteredGroups={filteredGroups}
            decisions={decisions}
            loading={loading}
            currentWeekKey={currentWeekKey}
            currentWeekMeta={currentWeekMeta}
            currentWeekIndex={currentWeekIndex}
            weekChanging={weekChanging}
            submittedCurrentWeekCount={submittedCurrentWeekCount}
            weekSubmissions={weekSubmissions}
            openWeekKeys={openWeekKeys}
            search={search}
            classFilter={classFilter}
            selectedGroupIds={selectedGroupIds}
            decisionMap={decisionMap}
            groupSubmittedWeeks={groupSubmittedWeeks}
            netRevenueMap={netRevenueMap}
            rankMap={rankMap}
            baseParams={baseParams}
            channelSim={channelSim}
            onSetWeek={handleSetWeek}
            onOpenWeeks={handleOpenWeeks}
            onCloseWeeks={handleCloseWeeks}
            onExport={handleExport}
            onBackupExport={handleBackupExport}
            onRestoreGroup={handleRestoreGroup}
            onHealthCheck={handleHealthCheck}
            healthChecking={healthChecking}
            healthCheckResults={healthCheckResults}
            onCloseHealthCheck={() => setHealthCheckResults(null)}
            onReload={loadData}
            onResetWeek={handleResetWeek}
            onResetPassword={handleResetPassword}
            onDelete={handleDeleteGroup}
            onBatchDelete={handleBatchDelete}
            onBatchReset={handleBatchResetPassword}
            onToggleSelect={toggleSelectGroup}
            onToggleSelectAll={toggleSelectAll}
            onSetSearch={setSearch}
            onSetClassFilter={setClassFilter}
            onViewGroup={setViewingGroup}
            onShowCreate={() => setShowCreate(true)}
            onShowBatchCreate={() => setShowBatchCreate(true)}
          />
        )}

        {activeTab === 'params' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-slate-800">基础参数设置</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                修改后立即生效，影响所有小组的计算结果与验证逻辑。
              </p>
            </div>
            {settingsId && (
              <BaseParamsPanel
                settingsId={settingsId}
                initial={baseParams}
                onSaved={(params) => {
                  setBaseParams(params);
                  setToast('基础参数已保存');
                }}
              />
            )}

            <div>
              <h2 className="text-base font-semibold text-slate-800">渠道成交算法参数</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                配置各渠道的转化率、流量上限、长尾释放、内容成本、爆款概率等参数。投放配额≠实际成交。
              </p>
            </div>
            {settingsId && (
              <ChannelSimConfigPanel
                settingsId={settingsId}
                initial={channelSim}
                onSaved={(cfg) => {
                  setChannelSim(cfg);
                  setToast('渠道算法参数已保存');
                }}
              />
            )}
          </div>
        )}

        {activeTab === 'market' && (
          <MarketEnvironmentTab
            settingsId={settingsId}
            benchmarkFiscalYear={benchmarkFiscalYear}
            benchmarkHotelClass={benchmarkHotelClass}
            onSettingsChanged={(fy, hc) => {
              setBenchmarkFiscalYear(fy);
              setBenchmarkHotelClass(hc);
              setToast('基准设置已更新');
            }}
          />
        )}

        {activeTab === 'deadline' && (
          <DeadlineTab
            settingsId={settingsId}
            submissionDeadline={submissionDeadline}
            lateSubmitDeadline={lateSubmitDeadline}
            groups={groups}
            weekSubmissions={weekSubmissions}
            groupSubmittedWeeks={groupSubmittedWeeks}
            openWeekKeys={openWeekKeys}
            onDeadlineChanged={(dl) => {
              setSubmissionDeadline(dl);
              setToast(dl ? '提交截止时间已设置' : '提交截止时间已清除');
            }}
            onLateDeadlineChanged={(dl) => {
              setLateSubmitDeadline(dl);
              setToast(dl ? '补交截止时间已设置' : '补交截止时间已清除');
            }}
          />
        )}
      </div>

      {showCreate && (
        <CreateGroupModal
          existingGroups={groups}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadData();
            setToast('小组创建成功');
          }}
        />
      )}

      {showBatchCreate && (
        <BatchCreateModal
          existingGroups={groups}
          onClose={() => setShowBatchCreate(false)}
          onCreated={(count) => {
            setShowBatchCreate(false);
            loadData();
            setToast(`已批量创建 ${count} 个小组`);
          }}
        />
      )}

      {showChangePassword && (
        <ChangeTeacherPasswordModal onClose={() => setShowChangePassword(false)} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Groups Tab ───────────────────────────────────────────────────────────────

interface GroupsTabProps {
  groups: GroupRow[];
  filteredGroups: GroupRow[];
  decisions: DecisionRow[];
  loading: boolean;
  currentWeekKey: string;
  currentWeekMeta: (typeof WEEKS)[number] | undefined;
  currentWeekIndex: number;
  weekChanging: boolean;
  submittedCurrentWeekCount: number;
  weekSubmissions: WeekSubmissionRow[];
  openWeekKeys: Set<string>;
  search: string;
  classFilter: string;
  selectedGroupIds: Set<string>;
  decisionMap: Map<string, DecisionRow>;
  groupSubmittedWeeks: Map<string, Set<string>>;
  netRevenueMap: Map<string, number>;
  rankMap: Map<string, number>;
  baseParams: BaseParams | null;
  channelSim: ChannelSimConfig | null;
  onSetWeek: (k: string) => void;
  onOpenWeeks: (keys: string[]) => void;
  onCloseWeeks: (keys: string[]) => void;
  onExport: () => void;
  onBackupExport: () => void;
  onRestoreGroup: (g: GroupRow) => void;
  onHealthCheck: () => void;
  healthChecking: boolean;
  healthCheckResults: Array<{ groupId: string; groupName: string; classLabel: string; weekKey: string; issue: string }> | null;
  onCloseHealthCheck: () => void;
  onReload: () => void;
  onResetWeek: (g: GroupRow, weekKey: string) => void;
  onResetPassword: (g: GroupRow) => void;
  onDelete: (g: GroupRow) => void;
  onBatchDelete: () => void;
  onBatchReset: () => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onSetSearch: (s: string) => void;
  onSetClassFilter: (s: string) => void;
  onViewGroup: (id: string) => void;
  onShowCreate: () => void;
  onShowBatchCreate: () => void;
}

function GroupsTab({
  groups,
  filteredGroups,
  loading,
  currentWeekKey,
  currentWeekMeta,
  currentWeekIndex,
  weekChanging,
  submittedCurrentWeekCount,
  weekSubmissions,
  openWeekKeys,
  search,
  classFilter,
  selectedGroupIds,
  decisionMap,
  groupSubmittedWeeks,
  netRevenueMap,
  rankMap,
  baseParams,
  channelSim,
  onSetWeek,
  onOpenWeeks,
  onCloseWeeks,
  onExport,
  onBackupExport,
  onRestoreGroup,
  onHealthCheck,
  healthChecking,
  healthCheckResults,
  onCloseHealthCheck,
  onReload,
  onResetWeek,
  onResetPassword,
  onDelete,
  onBatchDelete,
  onBatchReset,
  onToggleSelect,
  onToggleSelectAll,
  onSetSearch,
  onSetClassFilter,
  onViewGroup,
  onShowCreate,
  onShowBatchCreate,
}: GroupsTabProps) {
  const allSelected = filteredGroups.length > 0 && selectedGroupIds.size === filteredGroups.length;
  const someSelected = selectedGroupIds.size > 0;

  const [checkedWeeks, setCheckedWeeks] = useState<Set<string>>(new Set());
  const [rangeStart, setRangeStart] = useState<string>('');
  const [rangeEnd, setRangeEnd] = useState<string>('');

  function toggleCheckedWeek(key: string) {
    setCheckedWeeks((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <>
      {/* Week management: multi-week batch open/close */}
      <WeekManagementPanel
        openWeekKeys={openWeekKeys}
        checkedWeeks={checkedWeeks}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        weekChanging={weekChanging}
        groupsCount={groups.length}
        weekSubmissions={weekSubmissions}
        onToggleCheckedWeek={toggleCheckedWeek}
        onSetRangeStart={setRangeStart}
        onSetRangeEnd={setRangeEnd}
        onOpenWeeks={onOpenWeeks}
        onCloseWeeks={onCloseWeeks}
        onSetCurrentWeek={onSetWeek}
        currentWeekKey={currentWeekKey}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Users} label="小组总数" value={fmtNum(groups.length)} color="bg-blue-500" />
        <StatCard
          icon={Unlock}
          label="已开放周次"
          value={fmtNum(openWeekKeys.size)}
          color="bg-amber-500"
        />
        <StatCard
          icon={CheckCircle2}
          label={`当前周已提交`}
          value={fmtNum(submittedCurrentWeekCount)}
          color="bg-emerald-500"
        />
        <StatCard
          icon={Lock}
          label={`当前周未提交`}
          value={fmtNum(groups.length - submittedCurrentWeekCount)}
          color="bg-slate-400"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex flex-1 gap-2 max-w-xl">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <select
              value={classFilter}
              onChange={(e) => onSetClassFilter(e.target.value)}
              className={cn(
                'pl-9 pr-8 py-2 bg-white border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-300 appearance-none cursor-pointer',
                classFilter
                  ? 'border-amber-300 text-amber-800 bg-amber-50 font-medium'
                  : 'border-slate-200 text-slate-600',
              )}
            >
              <option value="">全部班级</option>
              {CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSetSearch(e.target.value)}
              placeholder="搜索小组名称..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-300"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {someSelected && (
            <>
              <button
                onClick={onBatchReset}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-100 transition"
              >
                <RotateCcw className="w-4 h-4" />
                重置密码 ({selectedGroupIds.size})
              </button>
              <button
                onClick={onBatchDelete}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100 transition"
              >
                <Trash2 className="w-4 h-4" />
                删除 ({selectedGroupIds.size})
              </button>
            </>
          )}
          <button
            onClick={onReload}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            刷新
          </button>
          <button
            onClick={onShowCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            <Plus className="w-4 h-4" />
            创建小组
          </button>
          <button
            onClick={onShowBatchCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            <Users className="w-4 h-4" />
            批量创建
          </button>
          <button
            onClick={onExport}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-medium rounded-lg hover:from-emerald-400 hover:to-emerald-500 transition shadow-md shadow-emerald-500/20"
          >
            <Download className="w-4 h-4" />
            导出 Excel
          </button>
          <button
            onClick={onBackupExport}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-blue-400 hover:to-blue-500 transition shadow-md shadow-blue-500/20"
          >
            <Download className="w-4 h-4" />
            全量备份导出
          </button>
          <button
            onClick={onHealthCheck}
            disabled={healthChecking}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-amber-300 text-amber-700 text-sm font-medium rounded-lg hover:bg-amber-50 transition disabled:opacity-50"
          >
            <ShieldAlert className={cn('w-4 h-4', healthChecking && 'animate-spin')} />
            {healthChecking ? '检查中...' : '数据健康检查'}
          </button>
        </div>
      </div>

      {healthCheckResults && (
        <div className="mb-4 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-slate-700">
                数据健康检查结果
              </span>
              {healthCheckResults.length === 0 ? (
                <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                  全部正常
                </span>
              ) : (
                <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded">
                  发现 {healthCheckResults.length} 个问题
                </span>
              )}
            </div>
            <button
              onClick={onCloseHealthCheck}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              关闭
            </button>
          </div>
          {healthCheckResults.length > 0 ? (
            <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {healthCheckResults.map((r, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="text-slate-400 text-xs w-8">#{i + 1}</span>
                  <span className="text-slate-700 font-medium min-w-[120px]">{r.groupName}</span>
                  <span className="text-slate-400 text-xs">{r.classLabel}</span>
                  <span className="text-amber-600 text-xs font-medium">{r.weekKey}</span>
                  <span className="text-red-600 text-xs flex-1">{r.issue}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              所有已提交周次的数据完整，未发现空数据或格式异常。
            </div>
          )}
        </div>
      )}

      {/* Groups table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">加载中...</div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            {groups.length === 0 ? '还没有小组，点击"创建小组"添加' : '没有匹配的小组'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-3 w-10">
                    <button onClick={onToggleSelectAll} className="text-slate-400 hover:text-slate-600">
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4 text-amber-500" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 font-medium text-slate-600 w-12">排名</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">班级</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">小组名称</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">酒店名称</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">
                    第{currentWeekMeta?.index}周状态
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">已提交周数</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600 whitespace-nowrap">出租率</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600 whitespace-nowrap">ADR</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600 whitespace-nowrap">RevPAR</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600 whitespace-nowrap">总佣金成本</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600 whitespace-nowrap">内容投流成本</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 whitespace-nowrap">净贡献</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGroups.map((g) => {
                  const d = decisionMap.get(g.id);
                  const cycle = d ? computeCycle(d.payload, baseParams, channelSim, g.id) : null;
                  const adr = cycle && cycle.totalRoomNights > 0 ? cycle.totalGrossRevenue / cycle.totalRoomNights : 0;
                  const subs = groupSubmittedWeeks.get(g.id) ?? new Set();
                  const submittedCurrentWeek = subs.has(currentWeekKey);
                  const rank = rankMap.get(g.id)!;
                  const isTopOne = rank === 1 && !!cycle;
                  const isSelected = selectedGroupIds.has(g.id);
                  return (
                    <tr
                      key={g.id}
                      onClick={() => onToggleSelect(g.id)}
                      className={cn(
                        'hover:bg-slate-50/50 transition cursor-pointer',
                        isTopOne && 'bg-amber-50/40',
                        isSelected && 'bg-amber-50/60',
                      )}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onToggleSelect(g.id)}
                          className="text-slate-400 hover:text-amber-500"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-amber-500" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {cycle ? (
                          <div className="flex justify-center">
                            <RankBadge rank={rank} />
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-sm">{g.class_label || '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{g.name}</td>
                      <td className="px-4 py-3 text-slate-600">{d?.hotel_name || g.hotel_name}</td>
                      <td className="px-4 py-3 text-center">
                        {(() => {
                          const sub = weekSubmissions.find((s) => s.group_id === g.id && s.week_key === currentWeekKey);
                          if (sub) {
                            if (sub.submission_status === 'late') {
                              return (
                                <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded">
                                  <Clock className="w-3.5 h-3.5" />
                                  逾期补交
                                </span>
                              );
                            }
                            return (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                按时提交
                              </span>
                            );
                          }
                          if (!d) {
                            return (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                <XCircle className="w-3.5 h-3.5" />
                                未填写
                              </span>
                            );
                          }
                          return (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                              <Clock className="w-3.5 h-3.5" />
                              未提交
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
                          {subs.size}
                          <span className="font-normal text-slate-400">/ {WEEKS.length}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600 whitespace-nowrap">
                        {cycle ? (cycle.overallOccupancy * 100).toFixed(1) + '%' : '-'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600 whitespace-nowrap">
                        {cycle ? adr.toFixed(2) : '-'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600 whitespace-nowrap">
                        {cycle ? cycle.overallRevpar.toFixed(2) : '-'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600 whitespace-nowrap">
                        {cycle ? cycle.totalCommission.toFixed(2) : '-'}
                      </td>
                      <td className="px-3 py-3 text-right text-orange-500 whitespace-nowrap">
                        {cycle && cycle.totalContentCost > 0 ? `-${cycle.totalContentCost.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700 whitespace-nowrap">
                        {cycle ? cycle.totalNetContribution.toFixed(2) : '-'}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {d && (
                            <button
                              onClick={() => onViewGroup(g.id)}
                              className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                              title="查看详情"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}
                          {submittedCurrentWeek ? (
                            <button
                              onClick={() => onResetWeek(g, currentWeekKey)}
                              className="p-1.5 text-slate-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition"
                              title={`退回第${currentWeekMeta?.index}周提交`}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              disabled
                              className="p-1.5 text-slate-300 rounded-lg cursor-not-allowed"
                              title="本周未提交，无需退回"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          <PasswordPeek password={g.password_plain} />
                          <button
                            onClick={() => onResetPassword(g)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title={`重置密码为 000000`}
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onRestoreGroup(g)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="从备份恢复该组数据"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDelete(g)}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="删除小组"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Week Management Panel ───────────────────────────────────────────────────

interface WeekManagementPanelProps {
  openWeekKeys: Set<string>;
  checkedWeeks: Set<string>;
  rangeStart: string;
  rangeEnd: string;
  weekChanging: boolean;
  groupsCount: number;
  weekSubmissions: WeekSubmissionRow[];
  onToggleCheckedWeek: (k: string) => void;
  onSetRangeStart: (k: string) => void;
  onSetRangeEnd: (k: string) => void;
  onOpenWeeks: (keys: string[]) => void;
  onCloseWeeks: (keys: string[]) => void;
  onSetCurrentWeek: (k: string) => void;
  currentWeekKey: string;
}

function WeekManagementPanel({
  openWeekKeys,
  checkedWeeks,
  rangeStart,
  rangeEnd,
  weekChanging,
  groupsCount,
  weekSubmissions,
  onToggleCheckedWeek,
  onSetRangeStart,
  onSetRangeEnd,
  onOpenWeeks,
  onCloseWeeks,
  onSetCurrentWeek,
  currentWeekKey,
}: WeekManagementPanelProps) {
  function getRangeKeys(): string[] {
    if (!rangeStart || !rangeEnd) return [];
    const si = WEEKS.findIndex((w) => w.key === rangeStart);
    const ei = WEEKS.findIndex((w) => w.key === rangeEnd);
    if (si < 0 || ei < 0) return [];
    const [lo, hi] = si <= ei ? [si, ei] : [ei, si];
    return WEEKS.slice(lo, hi + 1).map((w) => w.key);
  }

  const rangeKeys = getRangeKeys();
  const checkedArr = [...checkedWeeks];

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-5 mb-6 shadow-sm space-y-5">
      <div className="flex items-center gap-2">
        <Unlock className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-slate-800">周次开放管理</h2>
        <span className="text-xs text-slate-400">已开放 {openWeekKeys.size} / {WEEKS.length} 周</span>
      </div>

      {/* Batch open: checkbox mode */}
      <div className="border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <CheckSquare className="w-3.5 h-3.5 text-amber-500" />
            勾选式批量开放
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => onOpenWeeks(checkedArr)}
              disabled={weekChanging || checkedArr.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap className="w-3.5 h-3.5" />
              批量开放 ({checkedArr.length})
            </button>
            <button
              onClick={() => onCloseWeeks(checkedArr)}
              disabled={weekChanging || checkedArr.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-300 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Lock className="w-3.5 h-3.5" />
              批量关闭 ({checkedArr.length})
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {WEEKS.map((w) => {
            const isOpen = openWeekKeys.has(w.key);
            const isChecked = checkedWeeks.has(w.key);
            return (
              <button
                key={w.key}
                onClick={() => onToggleCheckedWeek(w.key)}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium transition border',
                  isChecked
                    ? 'border-amber-400 bg-amber-50 text-amber-700 ring-1 ring-amber-300'
                    : isOpen
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
              >
                <span className="flex items-center gap-1">
                  {isChecked ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                  第{w.index}周
                  {w.isPeak && <Flame className="w-2.5 h-2.5 text-amber-400" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Batch open: range mode */}
      <div className="border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
            区间式批量开放
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={rangeStart}
              onChange={(e) => onSetRangeStart(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              <option value="">起始周</option>
              {WEEKS.map((w) => (
                <option key={w.key} value={w.key}>第{w.index}周</option>
              ))}
            </select>
            <span className="text-slate-400 text-xs">→</span>
            <select
              value={rangeEnd}
              onChange={(e) => onSetRangeEnd(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              <option value="">结束周</option>
              {WEEKS.map((w) => (
                <option key={w.key} value={w.key}>第{w.index}周</option>
              ))}
            </select>
            <button
              onClick={() => onOpenWeeks(rangeKeys)}
              disabled={weekChanging || rangeKeys.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap className="w-3.5 h-3.5" />
              开放区间 ({rangeKeys.length})
            </button>
            <button
              onClick={() => onCloseWeeks(rangeKeys)}
              disabled={weekChanging || rangeKeys.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-300 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Lock className="w-3.5 h-3.5" />
              关闭区间
            </button>
          </div>
        </div>
      </div>

      {/* Week status list */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <h3 className="text-xs font-semibold text-slate-700">周次状态一览</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-3 py-2 font-medium text-slate-600">周次</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600">状态</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600">已提交</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600">未提交</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600">单周操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {WEEKS.map((w) => {
                const isOpen = openWeekKeys.has(w.key);
                const submittedCount = weekSubmissions.filter((s) => s.week_key === w.key).length;
                const unsubmittedCount = groupsCount - submittedCount;
                return (
                  <tr key={w.key} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">
                      第{w.index}周
                      {w.isPeak && <Flame className="w-3 h-3 inline ml-1 text-amber-400" />}
                      <span className="text-slate-400 ml-1.5 font-normal">{w.label}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isOpen ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs font-medium">
                          <Unlock className="w-3 h-3" />
                          已开放
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded text-xs font-medium">
                          <Lock className="w-3 h-3" />
                          已关闭
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-emerald-600 font-medium">{submittedCount}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{unsubmittedCount}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {isOpen ? (
                          <button
                            onClick={() => onCloseWeeks([w.key])}
                            disabled={weekChanging}
                            className="px-2 py-0.5 text-xs text-slate-600 border border-slate-200 rounded hover:bg-slate-100 transition"
                          >
                            关闭
                          </button>
                        ) : (
                          <button
                            onClick={() => onOpenWeeks([w.key])}
                            disabled={weekChanging}
                            className="px-2 py-0.5 text-xs text-amber-700 border border-amber-200 rounded hover:bg-amber-50 transition"
                          >
                            开放
                          </button>
                        )}
                        <button
                          onClick={() => onSetCurrentWeek(w.key)}
                          disabled={weekChanging}
                          className={cn(
                            'px-2 py-0.5 text-xs border rounded transition',
                            w.key === currentWeekKey
                              ? 'text-amber-700 border-amber-300 bg-amber-50 font-medium'
                              : 'text-slate-500 border-slate-200 hover:bg-slate-100',
                          )}
                        >
                          设为当前周
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Deadline Tab ─────────────────────────────────────────────────────────────

function DeadlineTab({
  settingsId,
  submissionDeadline,
  lateSubmitDeadline,
  groups,
  weekSubmissions,
  groupSubmittedWeeks,
  openWeekKeys,
  onDeadlineChanged,
  onLateDeadlineChanged,
}: {
  settingsId: string;
  submissionDeadline: string | null;
  lateSubmitDeadline: string | null;
  groups: GroupRow[];
  weekSubmissions: WeekSubmissionRow[];
  groupSubmittedWeeks: Map<string, Set<string>>;
  openWeekKeys: Set<string>;
  onDeadlineChanged: (dl: string | null) => void;
  onLateDeadlineChanged: (dl: string | null) => void;
}) {
  const [deadlineInput, setDeadlineInput] = useState(() => {
    if (!submissionDeadline) return '';
    const d = new Date(submissionDeadline);
    return d.toISOString().slice(0, 16);
  });
  const [lateInput, setLateInput] = useState(() => {
    if (!lateSubmitDeadline) return '';
    const d = new Date(lateSubmitDeadline);
    return d.toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [lateSaving, setLateSaving] = useState(false);
  const [error, setError] = useState('');
  const [lateError, setLateError] = useState('');

  const isDeadlinePassed = submissionDeadline ? new Date() > new Date(submissionDeadline) : false;
  const isLateDeadlinePassed = lateSubmitDeadline ? new Date() > new Date(lateSubmitDeadline) : false;

  async function handleSave() {
    setError('');
    setSaving(true);
    const iso = deadlineInput ? new Date(deadlineInput).toISOString() : null;
    const { error: err } = await supabase
      .from('app_settings')
      .update({ submission_deadline: iso, updated_at: new Date().toISOString() })
      .eq('id', settingsId);
    if (err) setError(err.message);
    else onDeadlineChanged(iso);
    setSaving(false);
  }

  async function handleClear() {
    setSaving(true);
    setDeadlineInput('');
    await supabase
      .from('app_settings')
      .update({ submission_deadline: null, updated_at: new Date().toISOString() })
      .eq('id', settingsId);
    onDeadlineChanged(null);
    setSaving(false);
  }

  async function handleSaveLate() {
    setLateError('');
    setLateSaving(true);
    const iso = lateInput ? new Date(lateInput).toISOString() : null;
    const { error: err } = await supabase
      .from('app_settings')
      .update({ late_submit_deadline: iso, updated_at: new Date().toISOString() })
      .eq('id', settingsId);
    if (err) setLateError(err.message);
    else onLateDeadlineChanged(iso);
    setLateSaving(false);
  }

  async function handleClearLate() {
    setLateSaving(true);
    setLateInput('');
    await supabase
      .from('app_settings')
      .update({ late_submit_deadline: null, updated_at: new Date().toISOString() })
      .eq('id', settingsId);
    onLateDeadlineChanged(null);
    setLateSaving(false);
  }

  // Submission matrix: groups × weeks
  const weekCols = WEEKS.slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="mb-1">
        <h2 className="text-base font-semibold text-slate-800">提交控制</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          管理提交截止时间与补交截止时间，控制学生的提交与补交权限。
        </p>
      </div>

      {/* Normal deadline control */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-800">提交截止时间</h3>
          <span className="text-xs text-slate-400">到期后进入补交阶段</span>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">截止时间</label>
            <input
              type="datetime-local"
              value={deadlineInput}
              onChange={(e) => setDeadlineInput(e.target.value)}
              className="w-full sm:w-72 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            />
          </div>
          <div className="flex gap-2">
            {submissionDeadline && (
              <button
                onClick={handleClear}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
              >
                <Unlock className="w-4 h-4" />
                清除
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition shadow-md shadow-amber-500/20 disabled:opacity-50"
            >
              <Calendar className="w-4 h-4" />
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-slate-100">
          {submissionDeadline ? (
            <div
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium',
                isDeadlinePassed
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200',
              )}
            >
              {isDeadlinePassed ? <CalendarClock className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
              <span>
                {isDeadlinePassed ? '已进入补交期：' : '截止时间：'}
                {new Date(submissionDeadline).toLocaleString('zh-CN', {
                  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
                {isDeadlinePassed ? '（学生可补交，直到补交截止）' : '（到时进入补交阶段）'}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-500">
              <Unlock className="w-4 h-4" />
              未设置截止时间，提交一直开放
            </div>
          )}
        </div>
      </div>

      {/* Late submit deadline control */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock className="w-4 h-4 text-orange-500" />
          <h3 className="text-sm font-semibold text-slate-800">补交截止时间</h3>
          <span className="text-xs text-slate-400">到期后所有未提交的开放周次自动锁定</span>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">补交截止时间</label>
            <input
              type="datetime-local"
              value={lateInput}
              onChange={(e) => setLateInput(e.target.value)}
              className="w-full sm:w-72 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400"
            />
          </div>
          <div className="flex gap-2">
            {lateSubmitDeadline && (
              <button
                onClick={handleClearLate}
                disabled={lateSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
              >
                <Unlock className="w-4 h-4" />
                清除
              </button>
            )}
            <button
              onClick={handleSaveLate}
              disabled={lateSaving}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm font-medium rounded-lg hover:from-orange-400 hover:to-orange-500 transition shadow-md shadow-orange-500/20 disabled:opacity-50"
            >
              <CalendarClock className="w-4 h-4" />
              {lateSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
        {lateError && (
          <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {lateError}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-slate-100">
          {lateSubmitDeadline ? (
            <div
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium',
                isLateDeadlinePassed
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-orange-50 text-orange-700 border border-orange-200',
              )}
            >
              {isLateDeadlinePassed ? <Lock className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
              <span>
                {isLateDeadlinePassed ? '已锁定：' : '补交截止：'}
                {new Date(lateSubmitDeadline).toLocaleString('zh-CN', {
                  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
                {isLateDeadlinePassed ? '（所有未提交周次已锁定）' : '（到时自动锁定未提交周次）'}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-500">
              <Unlock className="w-4 h-4" />
              未设置补交截止时间，开放周次可一直补交
            </div>
          )}
        </div>
      </div>

      {/* Submission overview matrix */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">各小组提交概览</h3>
          <span className="text-xs text-slate-400">
            总提交记录：{weekSubmissions.length} 条 / {groups.length * WEEKS.length} 条
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left px-3 py-2 font-medium text-slate-600 min-w-[120px]">
                  小组
                </th>
                {weekCols.map((w) => (
                  <th
                    key={w.key}
                    className="text-center px-2 py-2 font-medium text-slate-500 min-w-[36px]"
                  >
                    W{w.index}
                  </th>
                ))}
                {WEEKS.length > 12 &&
                  WEEKS.slice(12).map((w) => (
                    <th
                      key={w.key}
                      className="text-center px-2 py-2 font-medium text-slate-500 min-w-[36px]"
                    >
                      W{w.index}
                    </th>
                  ))}
                <th className="text-center px-3 py-2 font-medium text-slate-600">合计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {groups.map((g) => {
                const subs = groupSubmittedWeeks.get(g.id) ?? new Set();
                return (
                  <tr key={g.id} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-medium text-slate-700 truncate max-w-[140px]">
                      <span className="text-slate-400 text-xs mr-1">{g.class_label}</span>
                      {g.name}
                    </td>
                    {WEEKS.map((w) => (
                      <td key={w.key} className="px-2 py-2 text-center">
                        {subs.has(w.key) ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                        ) : (
                          <span className="w-3.5 h-3.5 inline-block rounded-full bg-slate-100 mx-auto" />
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center font-semibold text-slate-700">
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded',
                          subs.size === WEEKS.length
                            ? 'bg-emerald-50 text-emerald-700'
                            : subs.size > 0
                              ? 'bg-amber-50 text-amber-700'
                              : 'text-slate-400',
                        )}
                      >
                        {subs.size}/{WEEKS.length}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {groups.length === 0 && (
            <div className="py-8 text-center text-slate-400">暂无小组数据</div>
          )}
        </div>
      </div>

      {isLateDeadlinePassed && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-800">
            补交截止时间已过，所有未提交的开放周次已自动锁定。如需重新开放，请清除补交截止时间或设置新的补交截止时间。
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-white', color)}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs text-slate-500">{label}</div>
          <div className="text-xl font-bold text-slate-800">{value}</div>
        </div>
      </div>
    </div>
  );
}

function ChangeTeacherPasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < 6) { setError('新密码至少 6 位'); return; }
    if (next !== confirm) { setError('两次输入不一致'); return; }
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('app_settings')
        .select('id, teacher_password_hash')
        .limit(1)
        .maybeSingle();
      if (qErr) throw qErr;
      const storedHash = data?.teacher_password_hash ?? '';
      const ok = await verifyTeacherPassword(current, storedHash);
      if (!ok) { setError('当前密码错误'); setLoading(false); return; }
      const newHash = await hashPassword(next);
      const { error: uErr } = await supabase
        .from('app_settings')
        .update({ teacher_password_hash: newHash })
        .eq('id', data!.id);
      if (uErr) throw uErr;
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败');
    }
    setLoading(false);
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">密码修改成功</h3>
          <p className="text-sm text-slate-500 mb-5">下次登录请使用新密码</p>
          <button
            onClick={onClose}
            className="w-full py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-400 transition"
          >
            确定
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">修改教师密码</h3>
            <p className="text-xs text-slate-400">默认密码 teacher2024</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {([
            { label: '当前密码', value: current, setter: setCurrent, placeholder: '输入当前密码', visible: showCurrent, toggle: setShowCurrent, autoComplete: 'current-password' },
            { label: '新密码', value: next, setter: setNext, placeholder: '至少 6 位', visible: showNext, toggle: setShowNext, autoComplete: 'new-password' },
            { label: '确认新密码', value: confirm, setter: setConfirm, placeholder: '再次输入新密码', visible: showConfirm, toggle: setShowConfirm, autoComplete: 'new-password' },
          ] as const).map(({ label, value, setter, placeholder, visible, toggle, autoComplete }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
              <div className="relative">
                <input
                  type={visible ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  placeholder={placeholder}
                  autoComplete={autoComplete}
                  className="w-full px-3 py-2 pr-9 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => toggle((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                  aria-label={visible ? '隐藏密码' : '显示密码'}
                >
                  {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition">
              取消
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition disabled:opacity-50">
              {loading ? '保存中...' : '确认修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PasswordPeek({ password }: { password: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative inline-flex items-center">
      <button
        onClick={() => setVisible((v) => !v)}
        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
        title={visible ? '隐藏密码' : '查看密码'}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
      </button>
      {visible && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 text-white text-xs rounded-lg whitespace-nowrap shadow-lg z-20 font-mono">
          {password}
        </span>
      )}
    </div>
  );
}

function CreateGroupModal({ existingGroups, onClose, onCreated }: { existingGroups: GroupRow[]; onClose: () => void; onCreated: () => void }) {
  const [classLabel, setClassLabel] = useState('');
  const [name, setName] = useState('');
  const [hotelName, setHotelName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('请填写小组名称'); return; }
    const trimmedName = name.trim();
    const trimmedClass = classLabel.trim();
    const dup = existingGroups.some(
      (g) => g.name === trimmedName && g.class_label === trimmedClass,
    );
    if (dup) {
      setError(trimmedClass ? `该班级内已存在同名小组「${trimmedName}」` : `已存在同名小组「${trimmedName}」`);
      return;
    }
    setLoading(true);
    try {
      const DEFAULT_PASSWORD = '000000';
      const hash = await hashPassword(DEFAULT_PASSWORD);
      const { error: iErr } = await supabase.from('groups').insert({
        name: trimmedName,
        hotel_name: hotelName.trim(),
        class_label: trimmedClass,
        password_hash: hash,
        password_plain: DEFAULT_PASSWORD,
      });
      if (iErr) { setError(iErr.code === '23505' ? (trimmedClass ? `该班级内已存在同名小组「${trimmedName}」` : `已存在同名小组「${trimmedName}」`) : iErr.message); setLoading(false); return; }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <Users className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">创建新小组</h3>
            <p className="text-xs text-slate-400">初始登录密码统一为 000000</p>
          </div>
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">班级</label>
            <select
              value={classLabel}
              onChange={(e) => setClassLabel(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 appearance-none"
            >
              <option value="">请选择班级（可选）</option>
              {CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">
              小组名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：第一组"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">
              酒店名称 <span className="text-slate-400 font-normal text-xs">（选填）</span>
            </label>
            <input
              type="text"
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
              placeholder="如：星辰大酒店"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
            <KeyRound className="w-4 h-4 text-blue-500 shrink-0" />
            <p className="text-xs text-blue-700">
              初始密码统一为 <span className="font-mono font-semibold">000000</span>，学生首次登录后可自行修改
            </p>
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition">
              取消
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition disabled:opacity-50">
              {loading ? '创建中...' : '创建小组'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BatchCreateModal({
  existingGroups,
  onClose,
  onCreated,
}: {
  existingGroups: GroupRow[];
  onClose: () => void;
  onCreated: (count: number) => void;
}) {
  const [classLabel, setClassLabel] = useState('');
  const [prefix, setPrefix] = useState('第');
  const [suffix, setSuffix] = useState('组');
  const [startNum, setStartNum] = useState(1);
  const [endNum, setEndNum] = useState(10);
  const [hotelPrefix, setHotelPrefix] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const count = Math.max(0, endNum - startNum + 1);
  const preview = count > 0
    ? Array.from({ length: Math.min(count, 3) }, (_, i) => `${prefix}${startNum + i}${suffix}`).join('、') +
      (count > 3 ? `... 共 ${count} 个` : '')
    : '无';

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (count <= 0) { setError('结束编号须 ≥ 起始编号'); return; }
    if (count > 100) { setError('单次最多批量创建 100 个小组'); return; }
    const trimmedClass = classLabel.trim();
    const newNames = new Set(
      Array.from({ length: count }, (_, i) => `${prefix}${startNum + i}${suffix}`),
    );
    const dupsInClass = existingGroups.filter(
      (g) => g.class_label === trimmedClass && newNames.has(g.name),
    );
    if (dupsInClass.length > 0) {
      setError(`该班级内已存在同名小组：${dupsInClass.map((g) => g.name).join('、')}`);
      return;
    }
    setLoading(true);
    try {
      const DEFAULT_PASSWORD = '000000';
      const hash = await hashPassword(DEFAULT_PASSWORD);
      const rows = Array.from({ length: count }, (_, i) => ({
        name: `${prefix}${startNum + i}${suffix}`,
        hotel_name: hotelPrefix ? `${hotelPrefix}${startNum + i}号酒店` : '',
        class_label: trimmedClass,
        password_hash: hash,
        password_plain: DEFAULT_PASSWORD,
      }));
      const { error: iErr } = await supabase.from('groups').insert(rows);
      if (iErr) {
        setError(iErr.code === '23505' ? '该班级内部分小组名称已存在，请检查编号范围' : iErr.message);
        setLoading(false);
        return;
      }
      onCreated(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <Users className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">批量创建小组</h3>
            <p className="text-xs text-slate-400">按编号范围自动生成小组</p>
          </div>
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">班级</label>
            <select
              value={classLabel}
              onChange={(e) => setClassLabel(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 appearance-none"
            >
              <option value="">请选择班级（可选）</option>
              {CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">名称前缀</label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="如：第"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">名称后缀</label>
              <input
                type="text"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                placeholder="如：组"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">起始编号</label>
              <input
                type="number"
                min={1}
                value={startNum}
                onChange={(e) => setStartNum(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">结束编号</label>
              <input
                type="number"
                min={startNum}
                value={endNum}
                onChange={(e) => setEndNum(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">
              酒店名称前缀 <span className="text-slate-400 font-normal text-xs">（选填，留空则不设酒店名）</span>
            </label>
            <input
              type="text"
              value={hotelPrefix}
              onChange={(e) => setHotelPrefix(e.target.value)}
              placeholder="如：星辰大酒店"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            />
          </div>
          <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-xs text-slate-500">
              预览：<span className="font-medium text-slate-700">{preview}</span>
            </p>
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition">
              取消
            </button>
            <button type="submit" disabled={loading || count === 0} className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition disabled:opacity-50">
              {loading ? '创建中...' : `创建 ${count} 个小组`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
