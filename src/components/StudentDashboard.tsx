import { useMemo, useState, useEffect, useCallback, useRef, Fragment, type ReactNode } from 'react';
import {
  Plane,
  Utensils,
  Building2,
  User,
  Video,
  BookOpen,
  AlertCircle,
  CheckCircle2,
  Info,
  Send,
  Save,
  LogOut,
  Hotel,
  CloudRain,
  Music,
  Trophy,
  Briefcase,
  Flame,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  ShieldAlert,
  Tag,
  Store,
  History,
  Cloud,
  CloudOff,
  Loader2,
  TrendingUp,
  TrendingDown,
  HelpCircle,
  X,
  Plus,
  ChevronDown,
  Check,
  Compass,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { supabaseFetch, isNetworkError } from '../supabaseRequest';
import { hashPassword } from '../auth';
import {
  WEEKS,
  SPECIAL_FACTORS,
  TOTAL_ROOMS,
  emptyDecisionPayload,
  emptyWeekDecision,
  emptyChannelDecision,
  priceMax,
  priceMin,
  resolveChannels,
  resolveRoomTypes,
  resolveTotalRooms,
} from '../domain';
import type {
  AppSettingsRow,
  BaseParams,
  ChannelKey,
  ChannelSimConfig,
  DecisionPayload,
  GroupRow,
  OpenWeekRow,
  RoomTypeKey,
  WeekDecision,
  WeekSubmissionRow,
} from '../types';
import {
  computeCycle,
  weekQuotaTotal,
  roomTypeQuotaTotal,
  priceError,
  quotaError,
  validateWeek,
  hasActiveSpecialFactors,
} from '../calc';
import { cn, fmtMoney, fmtPct, fmtNum } from '../utils';
import ResultsPanel from './ResultsPanel';
import MarketReferencePage from './MarketReferencePage';

const ICONS: Record<string, LucideIcon> = {
  ctrip: Plane,
  meituan: Utensils,
  corporate: Building2,
  direct: User,
  douyin: Video,
  xhs: BookOpen,
};

const FACTOR_ICONS: Record<string, LucideIcon> = {
  weather: CloudRain,
  concert: Music,
  sports: Trophy,
  conference: Briefcase,
  local_emergency: ShieldAlert,
  ota_promotion: Tag,
  competitor_opening: Store,
};

interface Props {
  group: GroupRow;
  onGroupUpdate: (group: GroupRow) => void;
  onLogout: () => void;
}

type WeekTab = string | 'summary' | 'history';
type ViewMode = 'decision' | 'market';

// JSON-based deep clone — avoids structuredClone dependency on legacy/mobile browsers.
function clonePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default function StudentDashboard({ group, onGroupUpdate, onLogout }: Props) {
  const [payload, setPayload] = useState<DecisionPayload>(() => emptyDecisionPayload());
  const [hotelName, setHotelName] = useState(group.hotel_name);
  const [activeWeek, setActiveWeek] = useState<WeekTab>('wk1');
  const [viewMode, setViewMode] = useState<ViewMode>('decision');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // auto-save draft status: idle | saving | saved | error
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Password change
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);

  // Per-week submission tracking (week_key -> submission row)
  const [submittedWeeks, setSubmittedWeeks] = useState<Set<string>>(new Set());
  const [submissionStatusMap, setSubmissionStatusMap] = useState<Map<string, 'on_time' | 'late'>>(new Map());
  // Teacher-controlled current active week
  const [currentWeekKey, setCurrentWeekKey] = useState<string>('wk1');
  const [openWeekKeys, setOpenWeekKeys] = useState<Set<string>>(new Set());
  const [baseParams, setBaseParams] = useState<BaseParams | null>(null);
  const [channelSim, setChannelSim] = useState<ChannelSimConfig | null>(null);
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);
  const [lateSubmitDeadline, setLateSubmitDeadline] = useState<string | null>(null);
  const [benchmarkFiscalYear, setBenchmarkFiscalYear] = useState(2025);
  const [benchmarkHotelClass, setBenchmarkHotelClass] = useState('五星');

  const isDeadlinePassed = submissionDeadline ? new Date() > new Date(submissionDeadline) : false;
  const isLateDeadlinePassed = lateSubmitDeadline ? new Date() > new Date(lateSubmitDeadline) : false;
  // A week is locked if: submitted OR (late deadline passed) OR (not open)
  const isLateSubmitWindow = isDeadlinePassed && !isLateDeadlinePassed;

  const resolvedChannels = useMemo(() => resolveChannels(baseParams), [baseParams]);
  const resolvedRoomTypes = useMemo(() => resolveRoomTypes(baseParams), [baseParams]);
  const resolvedTotalRooms = useMemo(() => resolveTotalRooms(baseParams), [baseParams]);

  const cycleResult = useMemo(() => computeCycle(payload, baseParams, channelSim, group.id), [payload, baseParams, channelSim, group.id]);

  const isWeekLocked = useCallback(
    (weekKey: string) => submittedWeeks.has(weekKey),
    [submittedWeeks],
  );

  const isWeekOpen = useCallback(
    (weekKey: string) => openWeekKeys.has(weekKey),
    [openWeekKeys],
  );

  // A week is editable if: it's open AND not yet submitted AND late deadline not passed
  const isWeekEditable = useCallback(
    (weekKey: string) => isWeekOpen(weekKey) && !isWeekLocked(weekKey) && !isLateDeadlinePassed,
    [isWeekOpen, isWeekLocked, isLateDeadlinePassed],
  );

  // Latest state refs so debounced save always sends current data, not stale closure
  const payloadRef = useRef(payload);
  const hotelNameRef = useRef(hotelName);
  const decisionIdRef = useRef(decisionId);
  const activeWeekRef = useRef(activeWeek);
  const submittedWeeksRef = useRef(submittedWeeks);
  const serverUpdatedAtRef = useRef<string | null>(null);
  payloadRef.current = payload;
  hotelNameRef.current = hotelName;
  decisionIdRef.current = decisionId;
  activeWeekRef.current = activeWeek;
  submittedWeeksRef.current = submittedWeeks;

  // Debounced auto-save: persists ONLY the active week's data via save_week RPC.
  // Skips on initial load, submitted weeks, and after late deadline.
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutoSave = useRef(true);
  const lastSavedWeekDataRef = useRef<string>('');
  useEffect(() => {
    if (skipAutoSave.current) { return; }
    if (isLateDeadlinePassed) return;
    // Only autosave when viewing an editable (non-submitted, open) week
    const wk = activeWeekRef.current;
    if (wk === 'summary' || wk === 'history') return;
    if (submittedWeeksRef.current.has(wk)) return;
    // Skip if the active week's data hasn't actually changed since last save
    const weekData = payloadRef.current.weeks[wk];
    const serialized = JSON.stringify(weekData);
    if (serialized === lastSavedWeekDataRef.current) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setDraftStatus('saving');
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await persistDraft(wk);
        lastSavedWeekDataRef.current = serialized;
        setDraftStatus('saved');
        setTimeout(() => setDraftStatus('idle'), 1500);
      } catch (err) {
        setDraftStatus('error');
        if (isNetworkError(err)) {
          setToast('网络不佳，请检查网络后重试');
        } else if (err instanceof Error && err.message.includes('CONFLICT')) {
          setToast('数据已在别处更新，请刷新页面获取最新数据');
        }
      }
    }, 800);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, hotelName, isLateDeadlinePassed]);

  const activeWeekEditable =
    activeWeek !== 'summary' && activeWeek !== 'history' && isWeekEditable(activeWeek);

  const weekValidationErrors = useMemo(() => {
    if (activeWeek === 'summary') return [];
    return validateWeek(payload, activeWeek, baseParams);
  }, [payload, activeWeek]);

  const loadData = useCallback(async () => {
    setLoading(true);

    const [settingsRes, decRes, subRes, openRes] = await Promise.all([
      supabaseFetch(() =>
        supabase
          .from('app_settings')
          .select('current_week_key, submission_deadline, late_submit_deadline, base_params, benchmark_fiscal_year, benchmark_hotel_class, channel_sim')
          .maybeSingle(),
      ),
      supabaseFetch(() =>
        supabase
          .from('decisions')
          .select('*')
          .eq('group_id', group.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
      supabaseFetch(() =>
        supabase
          .from('week_submissions')
          .select('*')
          .eq('group_id', group.id),
      ),
      supabaseFetch(() =>
        supabase.from('open_weeks').select('week_key'),
      ),
    ]);
    setOpenWeekKeys(new Set((openRes.data as OpenWeekRow[] | null)?.map((r) => r.week_key) ?? []));

    let sBaseParams: BaseParams | null = null;
    if (settingsRes.data) {
      const s = settingsRes.data as AppSettingsRow;
      setCurrentWeekKey(s.current_week_key);
      setActiveWeek(s.current_week_key);
      sBaseParams = s.base_params ?? null;
      setBaseParams(sBaseParams);
      setChannelSim(s.channel_sim ?? null);
      setSubmissionDeadline(s.submission_deadline ?? null);
      setLateSubmitDeadline(s.late_submit_deadline ?? null);
      setBenchmarkFiscalYear(s.benchmark_fiscal_year ?? 2025);
      setBenchmarkHotelClass(s.benchmark_hotel_class ?? '五星');
    }

    if (decRes.error) {
      setError(isNetworkError(decRes.error) ? '网络不佳，请检查网络后重试' : decRes.error.message);
      setLoading(false);
      return;
    }

    if (decRes.data) {
      const saved = decRes.data.payload as DecisionPayload;
      const allChannels = resolveChannels(sBaseParams);
      const allRoomTypes = resolveRoomTypes(sBaseParams);
      // Build base template, then OVERWRITE each week that exists in saved data.
      // This ensures: missing weeks get empty templates, existing weeks keep their data.
      const base = emptyDecisionPayload(allChannels, allRoomTypes);
      if (saved?.weeks) {
        // First, copy all saved week keys that exist (including any not in static WEEKS list)
        for (const savedWeekKey of Object.keys(saved.weeks)) {
          const savedWeek = saved.weeks[savedWeekKey];
          if (!savedWeek) continue;
          // Deep-merge saved data onto a fresh empty template for this week,
          // preserving saved values while filling any new channels/room types with defaults
          const merged = emptyWeekDecision(allChannels, allRoomTypes);
          if (savedWeek.channels) {
            for (const ch of allChannels) {
              const savedCh = savedWeek.channels[ch.key];
              if (savedCh) {
                const mergedCh = emptyChannelDecision(allRoomTypes);
                if (savedCh.roomTypes) {
                  for (const rt of allRoomTypes) {
                    const savedRt = savedCh.roomTypes[rt.key];
                    if (savedRt) {
                      // Deep merge: start with template defaults, overwrite with saved values
                      mergedCh.roomTypes[rt.key] = {
                        ...mergedCh.roomTypes[rt.key],
                        ...savedRt,
                      };
                    }
                  }
                }
                merged.channels[ch.key] = mergedCh;
              }
            }
          }
          merged.specialFactors = savedWeek.specialFactors ?? [];
          base.weeks[savedWeekKey] = merged;
        }
      }
      setPayload(base);
      setDecisionId(decRes.data.id);
      setHotelName(decRes.data.hotel_name);
      // Track server updated_at for optimistic concurrency
      serverUpdatedAtRef.current = decRes.data.updated_at ?? null;
      // Initialize lastSavedWeekData to suppress spurious autosave on load
      const loadedCurrentWeekKey = (settingsRes.data as AppSettingsRow | null)?.current_week_key ?? 'wk1';
      const initWeek = decRes.data.payload?.weeks?.[loadedCurrentWeekKey];
      lastSavedWeekDataRef.current = initWeek ? JSON.stringify(initWeek) : '';
    }

    if (subRes.data) {
      const subs = subRes.data as WeekSubmissionRow[];
      setSubmittedWeeks(new Set(subs.map((r) => r.week_key)));
      const sm = new Map<string, 'on_time' | 'late'>();
      for (const s of subs) {
        if (s.submission_status) sm.set(s.week_key, s.submission_status);
      }
      setSubmissionStatusMap(sm);
    }

    // Enable autosave only after server data is fully loaded, preventing
    // the initial payload set from triggering a spurious save that could
    // overwrite server data before it's been read.
    skipAutoSave.current = false;
    setLoading(false);
  }, [group.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  function updateChannel(
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    field: 'price' | 'quota',
    value: string,
  ) {
    if (!isWeekEditable(weekKey)) return;
    try {
      setPayload((prev) => {
        const next = clonePayload(prev) as DecisionPayload;
        const num = value === '' ? null : Number(value);
        const rt = next.weeks[weekKey]?.channels?.[channelKey]?.roomTypes?.[roomTypeKey];
        if (!rt) return prev;
        rt[field] = num;
        return next;
      });
    } catch {
      setToast('保存失败请重试');
    }
  }

  function toggleFactor(weekKey: string, factorKey: string) {
    if (!isWeekEditable(weekKey)) return;
    try {
      setPayload((prev) => {
        const next = clonePayload(prev) as DecisionPayload;
        const wd = next.weeks[weekKey];
        if (!wd) return prev;
        const factors = wd.specialFactors ?? [];
        if (factors.includes(factorKey)) {
          wd.specialFactors = factors.filter((f) => f !== factorKey);
        } else {
          wd.specialFactors = [...factors, factorKey];
        }
        return next;
      });
    } catch {
      setToast('保存失败请重试');
    }
  }

  function toggleWeekendPricing(
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    enabled: boolean,
  ) {
    if (!isWeekEditable(weekKey)) return;
    try {
      setPayload((prev) => {
        const next = clonePayload(prev) as DecisionPayload;
        const rt = next.weeks[weekKey]?.channels?.[channelKey]?.roomTypes?.[roomTypeKey];
        if (!rt) return prev;
        if (enabled) {
          rt.weekend_pricing_enabled = true;
          if (!Array.isArray(rt.weekend_days) || rt.weekend_days.length === 0) {
            rt.weekend_days = [5, 6];
          }
          if (rt.weekday_price == null) rt.weekday_price = rt.price;
          if (rt.weekend_price == null) rt.weekend_price = rt.price;
        } else {
          rt.weekend_pricing_enabled = false;
          rt.weekend_days = [];
        }
        return next;
      });
    } catch {
      setToast('保存失败请重试');
    }
  }

  function toggleWeekendDay(
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    day: number,
  ) {
    if (!isWeekEditable(weekKey)) return;
    try {
      setPayload((prev) => {
        const next = clonePayload(prev) as DecisionPayload;
        const rt = next.weeks[weekKey]?.channels?.[channelKey]?.roomTypes?.[roomTypeKey];
        if (!rt) return prev;
        const days = Array.isArray(rt.weekend_days) ? rt.weekend_days : [];
        if (days.includes(day)) {
          rt.weekend_days = days.filter((d) => d !== day);
        } else {
          rt.weekend_days = [...days, day].sort((a, b) => a - b);
        }
        return next;
      });
    } catch {
      setToast('保存失败请重试');
    }
  }

  function updateWeekendPrice(
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    field: 'weekday_price' | 'weekend_price',
    value: string,
  ) {
    if (!isWeekEditable(weekKey)) return;
    try {
      setPayload((prev) => {
        const next = clonePayload(prev) as DecisionPayload;
        const num = value === '' ? null : Number(value);
        const rt = next.weeks[weekKey]?.channels?.[channelKey]?.roomTypes?.[roomTypeKey];
        if (!rt) return prev;
        rt[field] = num;
        return next;
      });
    } catch {
      setToast('保存失败请重试');
    }
  }

  // Saves only the specified week's data via the save_week RPC.
  // The RPC deep-merges at the database level, preventing full-payload overwrites.
  // Includes optimistic concurrency via serverUpdatedAtRef.
  async function persistDraft(weekKey?: string) {
    const currentPayload = payloadRef.current;
    const currentHotelName = hotelNameRef.current;
    const wk = weekKey ?? activeWeekRef.current;
    if (wk === 'summary' || wk === 'history') return;

    // Never save a submitted week
    if (submittedWeeksRef.current.has(wk)) return;

    const weekData = currentPayload.weeks[wk];
    if (!weekData) return;

    const { data: rpcResult, error: rpcErr } = await supabaseFetch(() =>
      supabase.rpc('save_week', {
        p_group_id: group.id,
        p_week_key: wk,
        p_week_data: weekData as Record<string, unknown>,
        p_hotel_name: currentHotelName.trim(),
        p_group_name: group.name,
        p_expected_updated_at: serverUpdatedAtRef.current,
      }),
    );
    if (rpcErr) throw rpcErr;
    if (rpcResult) {
      const result = rpcResult as { ok?: boolean; updated_at?: string; decision_id?: string };
      if (result.updated_at) {
        serverUpdatedAtRef.current = result.updated_at;
      }
      if (result.decision_id && !decisionIdRef.current) {
        setDecisionId(result.decision_id);
        decisionIdRef.current = result.decision_id;
      }
    }
  }

  async function handleSaveDraft() {
    setSaving(true);
    setError('');
    try {
      await persistDraft();
      setToast('草稿已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
    setSaving(false);
  }

  async function handleSubmitWeek() {
    if (activeWeek === 'summary') return;
    if (isLateDeadlinePassed) {
      setError('补交截止时间已到，无法提交');
      return;
    }
    if (!isWeekOpen(activeWeek)) {
      setError('该周次未开放，无法提交');
      return;
    }
    if (weekValidationErrors.length > 0) {
      setError(weekValidationErrors[0]);
      return;
    }
    if (!hotelName.trim()) {
      setError('酒店名称不能为空');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const wk = activeWeek as string;
      const isLate = isDeadlinePassed;
      const weekData = payloadRef.current.weeks[wk];
      if (!weekData) {
        setError('本周数据缺失，请刷新页面后重试');
        setSubmitting(false);
        return;
      }

      // Atomic save + submit in a single server transaction via submit_week RPC.
      // submit_week calls save_week internally, then inserts the week_submissions
      // row. If either step fails, both are rolled back.
      const { data: rpcData, error: rpcErr } = await supabaseFetch(() =>
        supabase.rpc('submit_week', {
          p_group_id: group.id,
          p_week_key: wk,
          p_week_data: weekData as Record<string, unknown>,
          p_hotel_name: hotelNameRef.current.trim(),
          p_group_name: group.name,
          p_expected_updated_at: serverUpdatedAtRef.current,
          p_submission_status: isLate ? 'late' : 'on_time',
        }),
      );

      if (rpcErr) {
        const msg = rpcErr.message ?? '';
        if (msg.includes('SUBMITTED_WEEK_LOCKED')) {
          setError('本周已提交，无法重复提交');
        } else if (msg.includes('CONFLICT')) {
          setError('数据已在别处更新，请刷新页面获取最新数据后再提交');
        } else if (msg.includes('REJECT_EMPTY_OVERWRITE')) {
          setError('本周已有数据，无法用空数据覆盖，请刷新页面后重试');
        } else if (isNetworkError(rpcErr)) {
          setError('网络不佳，请检查网络后重试');
        } else {
          setError(msg || '提交失败');
        }
        setSubmitting(false);
        return;
      }

      // Update server timestamp and decision id from the RPC result
      const result = rpcData as { updated_at?: string; decision_id?: string } | null;
      if (result?.updated_at) {
        serverUpdatedAtRef.current = result.updated_at;
      } else {
        serverUpdatedAtRef.current = new Date().toISOString();
      }
      if (result?.decision_id && !decisionIdRef.current) {
        setDecisionId(result.decision_id);
        decisionIdRef.current = result.decision_id;
      }
      lastSavedWeekDataRef.current = JSON.stringify(weekData);

      setSubmittedWeeks((prev) => new Set([...prev, wk]));
      setSubmissionStatusMap((prev) => new Map([...prev, [wk, isLate ? 'late' : 'on_time']]));
      setToast(`第 ${WEEKS.find((w) => w.key === wk)?.index} 周决策已${isLate ? '逾期补交' : '按时提交'}并锁定`);
    } catch (err) {
      if (isNetworkError(err)) {
        setError('网络不佳，请检查网络后重试');
      } else if (err instanceof Error && err.message.includes('CONFLICT')) {
        setError('数据已在别处更新，请刷新页面获取最新数据后再提交');
      } else if (err instanceof Error && err.message.includes('SUBMITTED_WEEK_LOCKED')) {
        setError('本周已提交，无法重复提交');
      } else {
        setError(err instanceof Error ? err.message : '提交失败');
      }
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          <div className="text-slate-400 text-sm">正在连接服务器...</div>
        </div>
      </div>
    );
  }

  const currentWeekData =
    activeWeek !== 'summary' && activeWeek !== 'history' ? payload.weeks[activeWeek] : null;

  const activeWeekMeta = WEEKS.find((w) => w.key === activeWeek);

  async function handleChangePassword() {
    setPwdError('');
    if (!oldPwd || !newPwd || !confirmPwd) {
      setPwdError('请填写所有字段');
      return;
    }
    if (newPwd.length < 6) {
      setPwdError('新密码至少6位');
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError('两次输入的新密码不一致');
      return;
    }
    const oldHash = await hashPassword(oldPwd);
    if (oldHash !== group.password_hash) {
      setPwdError('原密码不正确');
      return;
    }
    const newHash = await hashPassword(newPwd);
    setPwdSaving(true);
    const { error: dbErr } = await supabaseFetch(() =>
      supabase
        .from('groups')
        .update({ password_hash: newHash, password_plain: newPwd })
        .eq('id', group.id),
    );
    setPwdSaving(false);
    if (dbErr) {
      setPwdError(isNetworkError(dbErr) ? '网络不佳，请检查网络后重试' : '保存失败：' + dbErr.message);
      return;
    }
    group.password_hash = newHash;
    group.password_plain = newPwd;
    onGroupUpdate(group);
    setShowPwdModal(false);
    setToast('密码修改成功');
    setTimeout(() => setToast(''), 3000);
  }

  if (viewMode === 'market') {
    return (
      <MarketReferencePage
        fiscalYear={benchmarkFiscalYear}
        hotelClass={benchmarkHotelClass}
        cycleResult={cycleResult}
        channels={resolvedChannels}
        baseParams={baseParams}
        channelSim={channelSim}
        currentWeekKey={currentWeekKey}
        groupId={group.id}
        payload={payload}
        submittedWeeks={submittedWeeks}
        onBack={() => setViewMode('decision')}
        onGoToDecision={(weekKey) => {
          setActiveWeek(weekKey);
          setViewMode('decision');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center flex-shrink-0">
              <Hotel className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-slate-800 truncate">
                渠道运营决策填写
              </h1>
              <p className="text-xs text-slate-500 truncate">
                {group.class_label && (
                  <span className="mr-1.5">{group.class_label} ·</span>
                )}
                {group.name} · {hotelName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 text-xs font-medium rounded-lg border border-amber-200">
              当前周：第{WEEKS.find((w) => w.key === currentWeekKey)?.index ?? '-'}周
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-600 text-xs font-medium rounded-lg border border-slate-200">
              已开放 {openWeekKeys.size} 周 · 已提交 {submittedWeeks.size} 周
            </span>
            <DraftStatusBadge status={draftStatus} />
            <button
              onClick={() => setViewMode('market')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition border',
                viewMode === 'market'
                  ? 'bg-teal-500 text-white border-teal-500'
                  : 'text-teal-700 hover:bg-teal-50 border-teal-200 hover:border-teal-300',
              )}
            >
              <Compass className="w-4 h-4" />
              市场参考
            </button>
            <button
              onClick={() => setShowRulesModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition border border-slate-200 hover:border-amber-200"
            >
              <HelpCircle className="w-4 h-4" />
              规则说明
            </button>
            <button
              onClick={() => { setOldPwd(''); setNewPwd(''); setConfirmPwd(''); setPwdError(''); setShowOldPwd(false); setShowNewPwd(false); setShowConfirmPwd(false); setShowPwdModal(true); }}
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
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {(isDeadlinePassed || isLateDeadlinePassed) && (
          <div className={cn('flex items-center gap-3 px-4 py-3 border rounded-xl mb-5 text-sm', isLateDeadlinePassed ? 'bg-red-50 border-red-200 text-red-700' : 'bg-orange-50 border-orange-200 text-orange-700')}>
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              {isLateDeadlinePassed
                ? `补交截止时间已到（${new Date(lateSubmitDeadline!).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}），所有未提交的周次已锁定，如有疑问请联系授课教师。`
                : `已进入补交阶段（提交截止时间已过），已开放的周次仍可补交，补交截止：${lateSubmitDeadline ? new Date(lateSubmitDeadline).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未设置'}`}
            </span>
          </div>
        )}
        {/* Basic info */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-500" />
            基础信息
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                班级
              </label>
              <input
                type="text"
                value={group.class_label || '—'}
                disabled
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                小组名称
              </label>
              <input
                type="text"
                value={group.name}
                disabled
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                酒店名称
              </label>
              <input
                type="text"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                酒店总房量
              </label>
              <input
                type="text"
                value={`${resolvedTotalRooms} 间`}
                disabled
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                运营周期
              </label>
              <input
                type="text"
                value="9月14日 - 12月14日"
                disabled
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {resolvedRoomTypes.map((rt) => (
              <span
                key={rt.key}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-600"
              >
                <span className="font-medium text-slate-700">{rt.name}</span>
                <span className="text-slate-400">{rt.inventory}间</span>
              </span>
            ))}
          </div>
        </div>

        {/* Week tabs */}
        <div className="flex gap-1 mb-6 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          {WEEKS.map((w) => {
            const locked = isWeekLocked(w.key);
            const isOpen = isWeekOpen(w.key);
            const isActive = activeWeek === w.key;
            const subStatus = submissionStatusMap.get(w.key);
            return (
              <button
                key={w.key}
                onClick={() => setActiveWeek(w.key)}
                className={cn(
                  'flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap relative',
                  isActive
                    ? locked
                      ? subStatus === 'late'
                        ? 'bg-orange-500 text-white shadow'
                        : 'bg-emerald-600 text-white shadow'
                      : isOpen
                        ? 'bg-amber-500 text-white shadow'
                        : 'bg-slate-300 text-white shadow'
                    : locked
                      ? subStatus === 'late'
                        ? 'text-orange-700 bg-orange-50 hover:bg-orange-100'
                        : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                      : isOpen
                        ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 ring-1 ring-amber-300'
                        : 'text-slate-400 hover:bg-slate-100',
                )}
              >
                <span>第{w.index}周</span>
                {w.isPeak && (
                  <Flame className="w-3.5 h-3.5 inline ml-1 text-amber-400" />
                )}
                {locked && (
                  <Lock className="w-3 h-3 inline ml-1 opacity-70" />
                )}
                {!locked && !isOpen && (
                  <Lock className="w-3 h-3 inline ml-1 opacity-40" />
                )}
              </button>
            );
          })}
          <button
            onClick={() => setActiveWeek('summary')}
            className={cn(
              'flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap',
              activeWeek === 'summary'
                ? 'bg-amber-500 text-white shadow'
                : 'text-amber-700 hover:bg-amber-50',
            )}
          >
            全周期汇总
          </button>
          <button
            onClick={() => setActiveWeek('history')}
            className={cn(
              'flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap inline-flex items-center gap-1.5',
              activeWeek === 'history'
                ? 'bg-indigo-500 text-white shadow'
                : 'text-indigo-700 hover:bg-indigo-50',
            )}
          >
            <History className="w-4 h-4" />
            历史复盘
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {activeWeek === 'summary' ? (
          <ResultsPanel result={cycleResult} roomTypes={resolvedRoomTypes} />
        ) : activeWeek === 'history' ? (
          <HistoryReview
            payload={payload}
            cycleResult={cycleResult}
            submittedWeeks={submittedWeeks}
            baseParams={baseParams}
          />
        ) : (
          currentWeekData && (
            <WeekForm
              weekKey={activeWeek}
              weekDecision={currentWeekData}
              isLocked={isWeekLocked(activeWeek)}
              isCurrentWeek={isWeekOpen(activeWeek)}
              onChannelUpdate={updateChannel}
              onToggleFactor={toggleFactor}
              onToggleWeekendPricing={toggleWeekendPricing}
              onToggleWeekendDay={toggleWeekendDay}
              onUpdateWeekendPrice={updateWeekendPrice}
              weekResult={cycleResult.weeks.find(
                (w) => w.weekKey === activeWeek,
              )!}
              channels={resolvedChannels}
              roomTypes={resolvedRoomTypes}
              totalRooms={resolvedTotalRooms}
              overrides={baseParams}
            />
          )
        )}

        {activeWeek !== 'summary' && activeWeek !== 'history' && (
          <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="text-sm text-slate-500">
              {isWeekLocked(activeWeek) ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  第{activeWeekMeta?.index}周已{submissionStatusMap.get(activeWeek) === 'late' ? '逾期补交' : '按时提交'}锁定
                </span>
              ) : !isWeekOpen(activeWeek) ? (
                <span className="inline-flex items-center gap-1.5 text-slate-400">
                  <Info className="w-4 h-4" />
                  该周次未开放，等待教师开放
                </span>
              ) : isLateDeadlinePassed ? (
                <span className="inline-flex items-center gap-1.5 text-red-600">
                  <Lock className="w-4 h-4" />
                  补交截止时间已到，无法提交
                </span>
              ) : weekValidationErrors.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  还剩 {weekValidationErrors.length} 项校验未通过
                </span>
              ) : isDeadlinePassed ? (
                <span className="inline-flex items-center gap-1.5 text-orange-600">
                  <AlertCircle className="w-4 h-4" />
                  补交阶段：校验通过，可逾期补交本周决策
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  校验通过，可提交本周决策
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {activeWeekEditable && (
                <>
                  <button
                    onClick={handleSaveDraft}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? '保存中...' : '保存草稿'}
                  </button>
                  <button
                    onClick={handleSubmitWeek}
                    disabled={
                      submitting ||
                      weekValidationErrors.length > 0 ||
                      !hotelName.trim()
                    }
                    className="inline-flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition shadow-md shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-4 h-4" />
                    {submitting
                      ? '提交中...'
                      : `提交第${activeWeekMeta?.index}周决策`}
                  </button>
                </>
              )}
              {isWeekLocked(activeWeek) && (
                <div className="text-sm text-slate-500 px-2 py-2 flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-emerald-500" />
                  已提交，无法修改。如需调整请联系教师。
                </div>
              )}
              {!isWeekLocked(activeWeek) && !isWeekOpen(activeWeek) && (
                <div className="text-sm text-slate-400 px-2 py-2 flex items-center gap-1.5">
                  <Lock className="w-4 h-4" />
                  等待教师开放本周
                </div>
              )}
            </div>
          </div>
        )}

        {activeWeek === 'summary' && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        )}

        {activeWeek === 'history' && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl animate-fadeIn">
          {toast}
        </div>
      )}

      {showPwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-800">修改密码</h2>
                <p className="text-xs text-slate-400">修改后下次登录生效</p>
              </div>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">原密码</label>
                <div className="relative">
                  <input
                    type={showOldPwd ? 'text' : 'password'}
                    value={oldPwd}
                    onChange={(e) => setOldPwd(e.target.value)}
                    placeholder="输入原密码"
                    autoComplete="current-password"
                    className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOldPwd((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                    aria-label={showOldPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showOldPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">新密码</label>
                <div className="relative">
                  <input
                    type={showNewPwd ? 'text' : 'password'}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder="至少6位"
                    autoComplete="new-password"
                    className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPwd((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                    aria-label={showNewPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">确认新密码</label>
                <div className="relative">
                  <input
                    type={showConfirmPwd ? 'text' : 'password'}
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    placeholder="再次输入新密码"
                    autoComplete="new-password"
                    className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPwd((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                    aria-label={showConfirmPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {pwdError && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {pwdError}
                </p>
              )}
              <div className="flex gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setShowPwdModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={pwdSaving}
                  className="flex-1 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  {pwdSaving ? '保存中...' : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showRulesModal && (
        <RulesModal channels={resolvedChannels} roomTypes={resolvedRoomTypes} totalRooms={resolvedTotalRooms} onClose={() => setShowRulesModal(false)} />
      )}
    </div>
  );
}

interface RulesModalProps {
  channels: import('../types').ChannelMeta[];
  roomTypes: import('../types').RoomTypeMeta[];
  totalRooms: number;
  onClose: () => void;
}

function RulesModal({ channels, roomTypes, totalRooms, onClose }: RulesModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
              <HelpCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">决策规则说明</h2>
              <p className="text-xs text-slate-400">了解各功能按键的具体规则与玩法</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-6">
          {/* 1. 渠道定价 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">1</span>
              渠道与定价
            </h3>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              平台共有 {channels.length} 个分销渠道，每个渠道有不同的佣金率和价格弹性。你需要为每个渠道的每种房型设定合适的定价。
            </p>
            <div className="space-y-2">
              {channels.map((ch) => (
                <div key={ch.key} className="flex items-start gap-2.5 px-3 py-2 bg-slate-50 rounded-lg">
                  <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                    {(() => {
                      const Icon = ICONS[ch.key] || Info;
                      return <Icon className="w-3.5 h-3.5 text-slate-600" />;
                    })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-700">{ch.name}</span>
                      <span className="text-xs text-slate-400">佣金 {(ch.commissionRate * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{ch.description}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 leading-relaxed">
              <strong>定价区间：</strong>每个渠道×房型的定价下限为「渠道底价 × 房型系数」，上限为「门市价 × 2」。低于下限或高于上限均无法提交。
            </div>
          </section>

          {/* 2. 房型与配额 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">2</span>
              房型与配额分配
            </h3>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              酒店共 {totalRooms} 间客房，分为 {roomTypes.length} 种房型。你需要在各渠道间合理分配每种房型的配额。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {roomTypes.map((rt) => (
                <div key={rt.key} className="px-3 py-2.5 bg-slate-50 rounded-lg">
                  <div className="text-sm font-medium text-slate-700">{rt.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{rt.inventory} 间</div>
                  <div className="text-xs text-slate-400 mt-1">门市价系数 ×{rt.priceMultiplier.toFixed(2)}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 leading-relaxed">
                <strong>配额规则：</strong>各渠道同一房型的配额之和不得超过该房型总房量；所有渠道所有房型的配额总和不得超过酒店总房量 {totalRooms} 间。
              </div>
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
                <strong>配额为整数：</strong>配额只能填写非负整数，不能填写小数或负数。
              </div>
            </div>
          </section>

          {/* 3. 特殊因素 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">3</span>
              特殊需求因素
            </h3>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              每周可勾选若干特殊因素，它们会按系数叠加影响本周的需求量（最终出租率 = 基准出租率 × 所有因素系数乘积 × 价格弹性）。
            </p>
            <div className="space-y-1.5">
              {SPECIAL_FACTORS.map((f) => (
                <div key={f.key} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const Icon = FACTOR_ICONS[f.key] || Info;
                      return <Icon className={cn('w-4 h-4', f.demandMultiplier > 1 ? 'text-emerald-500' : 'text-red-400')} />;
                    })()}
                    <span className="text-sm text-slate-700">{f.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn('text-xs font-semibold', f.demandMultiplier > 1 ? 'text-emerald-600' : 'text-red-500')}>
                      ×{f.demandMultiplier.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
              <strong>叠加效应：</strong>多个因素同时勾选时，系数相乘。例如勾选「演唱会(×1.18)」+「OTA促销(×1.08)」，总需求系数为 1.18 × 1.08 = 1.27。
            </div>
          </section>

          {/* 4. 价格弹性 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">4</span>
              价格弹性与销量
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-3">
              定价直接影响实际出租率（价格弹性）。定价越低于渠道基准价，弹性越高、卖得越多；定价越高，弹性越低、卖得越少。不同渠道对价格的敏感度也不同：
            </p>
            <div className="px-3 py-2.5 bg-slate-50 rounded-lg text-xs text-slate-600 space-y-1.5 leading-relaxed">
              <div>· <strong>美团、抖音</strong>：价格敏感度最高，降价促销效果最显著</div>
              <div>· <strong>小红书</strong>：价格敏感度较高</div>
              <div>· <strong>携程</strong>：价格敏感度中等</div>
              <div>· <strong>散客直销</strong>：价格敏感度较低，客群对价格不敏感</div>
              <div>· <strong>企业协议客</strong>：价格敏感度最低，价格变动对销量影响小</div>
            </div>
            <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 leading-relaxed">
              <strong>净营收 = 毛营收 − 佣金。</strong>高佣金渠道（如携程15%）需要更高的定价或更大的销量才能获得同等净收入，低佣金渠道（如直销、协议客0%）每单到手更多。
            </div>
          </section>

          {/* 5. 周次与提交 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">5</span>
              周次切换与提交规则
            </h3>
            <div className="space-y-1.5">
              <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed">
                <strong>当前开放周：</strong>教师每周开放一个周次，只有当前开放周可以填写和提交决策。未开放的周次会显示「等待教师开放本周」。
              </div>
              <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed">
                <strong>提交锁定：</strong>提交本周决策后该周立即锁定，无法再修改。如需调整，请联系教师退回提交。已提交的周次标签会显示绿色锁标。
              </div>
              <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed">
                <strong>自动保存草稿：</strong>编辑过程中系统会自动保存草稿，即使关闭浏览器也不会丢失。也可手动点击「保存草稿」。
              </div>
              <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed">
                <strong>截止时间：</strong>若教师设置了提交截止时间，到期后所有周的提交权限将自动锁定。
              </div>
              <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed">
                <strong>旺季标识：</strong>标有火焰图标的周次为旺季（如国庆、跨年），基准出租率更高（88% vs 平周62%），可适当上调定价。
              </div>
            </div>
          </section>

          {/* 6. 汇总与复盘 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">6</span>
              全周期汇总与历史复盘
            </h3>
            <div className="space-y-1.5">
              <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed">
                <strong>全周期汇总：</strong>点击「全周期汇总」可查看整个运营周期（9月14日–12月14日）的综合表现，包括总净营收、整体出租率、RevPAR 等核心指标，以及各渠道和房型的收益占比。
              </div>
              <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed">
                <strong>历史复盘：</strong>点击「历史复盘」可对比已提交各周的决策明细与收益表现，查看渠道收益排名和跨周趋势图，帮助优化后续策略。
              </div>
            </div>
          </section>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}

interface WeekFormProps {
  weekKey: string;
  weekDecision: WeekDecision;
  isLocked: boolean;
  isCurrentWeek: boolean;
  onChannelUpdate: (
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    field: 'price' | 'quota',
    value: string,
  ) => void;
  onToggleFactor: (weekKey: string, factorKey: string) => void;
  onToggleWeekendPricing: (
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    enabled: boolean,
  ) => void;
  onToggleWeekendDay: (
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    day: number,
  ) => void;
  onUpdateWeekendPrice: (
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    field: 'weekday_price' | 'weekend_price',
    value: string,
  ) => void;
  weekResult: import('../types').WeekResult;
  channels: import('../types').ChannelMeta[];
  roomTypes: import('../types').RoomTypeMeta[];
  totalRooms: number;
  overrides: import('../types').BaseParams | null;
}

function WeekForm({
  weekKey,
  weekDecision,
  isLocked,
  isCurrentWeek,
  onChannelUpdate,
  onToggleFactor,
  onToggleWeekendPricing,
  onToggleWeekendDay,
  onUpdateWeekendPrice,
  weekResult,
  channels,
  roomTypes,
  totalRooms,
  overrides,
}: WeekFormProps) {
  const week = WEEKS.find((w) => w.key === weekKey)!;
  const totalQuota = weekQuotaTotal(weekDecision, overrides);
  const totalOverflow = totalQuota > totalRooms;
  const disabled = isLocked || !isCurrentWeek;

  return (
    <div className="space-y-5">
      {/* Week header */}
      <div
        className={cn(
          'rounded-xl p-4 text-white shadow-md',
          isLocked
            ? 'bg-gradient-to-r from-emerald-700 to-emerald-600'
            : isCurrentWeek
              ? week.isPeak
                ? 'bg-gradient-to-r from-amber-600 to-amber-500'
                : 'bg-gradient-to-r from-slate-800 to-slate-700'
              : 'bg-gradient-to-r from-slate-400 to-slate-300',
        )}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              第{week.index}周
              {week.isPeak && (
                <span className="inline-flex items-center gap-1 text-xs bg-white/20 px-2 py-0.5 rounded-full">
                  <Flame className="w-3 h-3" />
                  {week.peakTag}
                </span>
              )}
              {isLocked && (
                <span className="inline-flex items-center gap-1 text-xs bg-white/20 px-2 py-0.5 rounded-full">
                  <Lock className="w-3 h-3" />
                  已提交
                </span>
              )}
              {!isLocked && !isCurrentWeek && (
                <span className="inline-flex items-center gap-1 text-xs bg-white/20 px-2 py-0.5 rounded-full">
                  <Lock className="w-3 h-3" />
                  未开放
                </span>
              )}
            </h3>
            <p className="text-sm text-white/80">
              {week.label} · {week.days}天
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs opacity-80">基准出租率</div>
            <div className="text-lg font-bold">
              {(week.baseOccupancy * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      {/* Quota bars */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <QuotaBar
          label="总房量配额"
          used={totalQuota}
          cap={totalRooms}
          overflow={totalOverflow}
        />
        {roomTypes.map((rt) => {
          const used = roomTypeQuotaTotal(weekDecision, rt.key, overrides);
          return (
            <QuotaBar
              key={rt.key}
              label={rt.name}
              used={used}
              cap={rt.inventory}
              overflow={used > rt.inventory}
            />
          );
        })}
      </div>

      {/* Channel × RoomType pricing cards */}
      <div className="space-y-4">
        {channels.map((ch) => {
          const Icon = ICONS[ch.key] || Plus;
          return (
            <div key={ch.key} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
                <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800">{ch.name}</div>
                  <div className="text-xs text-slate-400">佣金{(ch.commissionRate * 100).toFixed(0)}% · {ch.description}</div>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {roomTypes.map((rt) => {
                  const rtDec = weekDecision.channels[ch.key].roomTypes[rt.key];
                  const min = priceMin(ch.key, rt.key, overrides);
                  const max = priceMax(ch.key, rt.key, overrides);
                  const qErr = quotaError(rtDec.quota);
                  const weekendEnabled = rtDec.weekend_pricing_enabled === true;
                  const weekendDays = Array.isArray(rtDec.weekend_days) ? rtDec.weekend_days : [];
                  return (
                    <div key={rt.key} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700">{rt.name}</span>
                          <span className="text-xs text-slate-400">({rt.inventory}间)</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-500">区分周末价</span>
                            <div className="flex items-center bg-slate-100 rounded-full p-0.5">
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onToggleWeekendPricing(weekKey, ch.key, rt.key, false)}
                                className={cn(
                                  'px-2.5 py-1 rounded-full text-xs font-medium transition',
                                  !weekendEnabled ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400',
                                  disabled && 'cursor-not-allowed',
                                )}
                              >
                                否
                              </button>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onToggleWeekendPricing(weekKey, ch.key, rt.key, true)}
                                className={cn(
                                  'px-2.5 py-1 rounded-full text-xs font-medium transition',
                                  weekendEnabled ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-400',
                                  disabled && 'cursor-not-allowed',
                                )}
                              >
                                是
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {weekendEnabled ? (
                        <WeekendPricingSection
                          weekKey={weekKey}
                          channelKey={ch.key}
                          roomTypeKey={rt.key}
                          weekendDays={weekendDays}
                          weekdayPrice={rtDec.weekday_price ?? null}
                          weekendPrice={rtDec.weekend_price ?? null}
                          min={min}
                          max={max}
                          disabled={disabled}
                          onToggleDay={onToggleWeekendDay}
                          onUpdatePrice={onUpdateWeekendPrice}
                          specialFactorsActive={hasActiveSpecialFactors(weekDecision.specialFactors)}
                        />
                      ) : (
                        <div className="flex items-center gap-4 flex-wrap">
                          <PriceInput
                            value={rtDec.price}
                            onChange={(v) => onChannelUpdate(weekKey, ch.key, rt.key, 'price', v)}
                            disabled={disabled}
                            min={min}
                            max={max}
                            error={priceError(ch.key, rt.key, rtDec.price, overrides)}
                          />
                          <QuotaInput
                            value={rtDec.quota}
                            onChange={(v) => onChannelUpdate(weekKey, ch.key, rt.key, 'quota', v)}
                            disabled={disabled}
                            error={qErr}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Special factors */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">
          特殊需求因素
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          勾选后自动关联需求影响系数，影响本周预估出租率
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SPECIAL_FACTORS.map((f) => {
            const checked = weekDecision.specialFactors.includes(f.key);
            const Icon = FACTOR_ICONS[f.key] || Info;
            return (
              <button
                key={f.key}
                type="button"
                disabled={disabled}
                onClick={() => onToggleFactor(weekKey, f.key)}
                className={cn(
                  'relative p-4 rounded-xl border text-left transition-all',
                  checked
                    ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-400/20'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                  disabled && 'opacity-60 cursor-not-allowed',
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <Icon
                    className={cn(
                      'w-5 h-5',
                      checked ? 'text-amber-600' : 'text-slate-400',
                    )}
                  />
                  {checked && (
                    <CheckCircle2 className="w-4 h-4 text-amber-500" />
                  )}
                </div>
                <div className="text-sm font-medium text-slate-800">
                  {f.name}
                </div>
                <div
                  className={cn(
                    'text-xs mt-0.5 font-medium',
                    f.demandMultiplier > 1
                      ? 'text-emerald-600'
                      : 'text-red-500',
                  )}
                >
                  需求 ×{f.demandMultiplier.toFixed(2)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {f.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Week quick result */}
      <div className="bg-slate-800 rounded-xl p-5 text-white shadow-md">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Info className="w-4 h-4 text-amber-400" />
          本周实时预估
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard
            label="出租间夜数"
            value={fmtNum(weekResult.totalRoomNights)}
          />
          <MetricCard label="出租率" value={fmtPct(weekResult.occupancy)} />
          <MetricCard label="RevPAR" value={fmtMoney(weekResult.revpar)} />
          <MetricCard
            label="净营收"
            value={fmtMoney(weekResult.netRevenue)}
            accent
          />
        </div>
      </div>
    </div>
  );
}

function QuotaBar({
  label,
  used,
  cap,
  overflow,
}: {
  label: string;
  used: number;
  cap: number;
  overflow: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-3 border shadow-sm transition',
        overflow ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200',
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span
          className={cn(
            'text-xs font-bold',
            overflow ? 'text-red-600' : 'text-slate-700',
          )}
        >
          {used}/{cap}
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            overflow ? 'bg-red-500' : 'bg-emerald-500',
          )}
          style={{ width: `${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}%` }}
        />
      </div>
      {overflow && cap > 0 && (
        <div className="mt-1 text-xs text-red-600">超出 {used - cap} 间</div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div
        className={cn(
          'text-lg font-bold',
          accent ? 'text-amber-400' : 'text-white',
        )}
      >
        {value}
      </div>
    </div>
  );
}

const DAY_LABELS: { value: number; short: string; full: string }[] = [
  { value: 1, short: '一', full: '星期一' },
  { value: 2, short: '二', full: '星期二' },
  { value: 3, short: '三', full: '星期三' },
  { value: 4, short: '四', full: '星期四' },
  { value: 5, short: '五', full: '星期五' },
  { value: 6, short: '六', full: '星期六' },
  { value: 7, short: '日', full: '星期日' },
];

interface WeekendPricingSectionProps {
  weekKey: string;
  channelKey: ChannelKey;
  roomTypeKey: RoomTypeKey;
  weekendDays: number[];
  weekdayPrice: number | null;
  weekendPrice: number | null;
  min: number;
  max: number;
  disabled: boolean;
  onToggleDay: (
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    day: number,
  ) => void;
  onUpdatePrice: (
    weekKey: string,
    channelKey: ChannelKey,
    roomTypeKey: RoomTypeKey,
    field: 'weekday_price' | 'weekend_price',
    value: string,
  ) => void;
  specialFactorsActive: boolean;
}

function WeekendPricingSection({
  weekKey,
  channelKey,
  roomTypeKey,
  weekendDays,
  weekdayPrice,
  weekendPrice,
  min,
  max,
  disabled,
  onToggleDay,
  onUpdatePrice,
  specialFactorsActive,
}: WeekendPricingSectionProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const weekdayErr = priceError(channelKey, roomTypeKey, weekdayPrice, null);
  const weekendErr = priceError(channelKey, roomTypeKey, weekendPrice, null);

  return (
    <div className="space-y-3">
      {specialFactorsActive && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 leading-relaxed">
          本周已勾选特殊需求因素，周末价暂不生效，统一按原定价计算。取消特殊因素后周末价将自动恢复。
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500 shrink-0">周末日</span>
        <div className="relative flex-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDropdownOpen((v) => !v)}
            className={cn(
              'w-full min-h-[36px] px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-left flex items-center justify-between gap-2 transition',
              disabled ? 'bg-slate-50 cursor-not-allowed' : 'bg-white hover:border-amber-300',
              dropdownOpen && 'ring-2 ring-amber-500/20 border-amber-300',
            )}
          >
            <div className="flex flex-wrap gap-1 flex-1">
              {weekendDays.length === 0 ? (
                <span className="text-slate-400 text-xs py-0.5">点击选择周末日</span>
              ) : (
                weekendDays.map((d) => {
                  const label = DAY_LABELS.find((dl) => dl.value === d);
                  return (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium"
                    >
                      {label?.full ?? d}
                      {!disabled && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleDay(weekKey, channelKey, roomTypeKey, d);
                          }}
                          className="hover:text-amber-900 transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  );
                })
              )}
            </div>
            <ChevronDown className={cn('w-4 h-4 text-slate-400 transition shrink-0', dropdownOpen && 'rotate-180')} />
          </button>
          {dropdownOpen && !disabled && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute z-20 mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {DAY_LABELS.map((dl) => {
                  const checked = weekendDays.includes(dl.value);
                  return (
                    <button
                      key={dl.value}
                      type="button"
                      onClick={() => onToggleDay(weekKey, channelKey, roomTypeKey, dl.value)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 text-sm transition',
                        checked ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      <span>{dl.full}</span>
                      {checked && <Check className="w-4 h-4 text-amber-500" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {weekendDays.length === 7 && (
        <div className="text-xs text-amber-600">已勾选全部7天，相当于统一价格</div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 w-16">工作日价</span>
          <PriceInput
            value={weekdayPrice}
            onChange={(v) => onUpdatePrice(weekKey, channelKey, roomTypeKey, 'weekday_price', v)}
            disabled={disabled}
            min={min}
            max={max}
            error={weekdayErr}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 w-14">周末价</span>
          <PriceInput
            value={weekendPrice}
            onChange={(v) => onUpdatePrice(weekKey, channelKey, roomTypeKey, 'weekend_price', v)}
            disabled={disabled}
            min={min}
            max={max}
            error={weekendErr}
          />
        </div>
      </div>

      {weekendDays.length === 0 && (
        <div className="text-xs text-amber-600">请至少勾选1个周末日</div>
      )}
    </div>
  );
}

function PriceInput({
  value,
  onChange,
  disabled,
  min,
  max,
  error,
}: {
  value: number | null;
  onChange: (v: string) => void;
  disabled: boolean;
  min: number;
  max: number;
  error: string | null;
}) {
  return (
    <div className="w-24">
      <div className="relative">
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
          ¥
        </span>
        <input
          type="number"
          min={0}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={`${min}~${max}`}
          className={cn(
            'w-full pl-5 pr-1.5 py-1.5 text-sm border rounded-lg transition text-center',
            error
              ? 'border-red-400 bg-red-50'
              : 'border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-300',
            disabled && 'bg-slate-50 text-slate-400 cursor-not-allowed',
          )}
        />
      </div>
      {error && (
        <div className="text-xs text-red-500 mt-1 text-center">{error}</div>
      )}
    </div>
  );
}

function QuotaInput({
  value,
  onChange,
  disabled,
  error,
}: {
  value: number | null;
  onChange: (v: string) => void;
  disabled: boolean;
  error: string | null;
}) {
  return (
    <div className="w-20">
      <input
        type="number"
        min={0}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="0"
        className={cn(
          'w-full px-2 py-1.5 text-sm border rounded-lg text-center transition',
          error
            ? 'border-red-400 bg-red-50'
            : 'border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-300',
          disabled && 'bg-slate-50 text-slate-400 cursor-not-allowed',
        )}
      />
      {error && (
        <div className="text-xs text-red-500 mt-1 text-center">{error}</div>
      )}
    </div>
  );
}

// ─── Draft auto-save status badge ────────────────────────────────────────────

function DraftStatusBadge({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-400 text-xs rounded-lg border border-slate-200">
        <CloudOff className="w-3.5 h-3.5" />
        草稿
      </span>
    );
  }
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-lg border border-blue-200">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        自动保存中...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 text-xs font-medium rounded-lg border border-emerald-200">
        <Cloud className="w-3.5 h-3.5" />
        草稿已保存
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-lg border border-red-200">
      <AlertCircle className="w-3.5 h-3.5" />
      保存失败
    </span>
  );
}

// ─── History review component ─────────────────────────────────────────────────

interface HistoryReviewProps {
  payload: DecisionPayload;
  cycleResult: import('../types').CycleResult;
  submittedWeeks: Set<string>;
  baseParams: import('../types').BaseParams | null;
}

function HistoryReview({ payload, cycleResult, submittedWeeks, baseParams }: HistoryReviewProps) {
  const [selectedWeek, setSelectedWeek] = useState<string>(
    WEEKS.filter((w) => submittedWeeks.has(w.key)).slice(-1)[0]?.key ?? WEEKS[0].key,
  );

  const submittedWeekList = WEEKS.filter((w) => submittedWeeks.has(w.key));
  const hasHistory = submittedWeekList.length > 0;

  if (!hasHistory) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-700 mb-1">暂无历史轮次</h3>
        <p className="text-sm text-slate-400">
          提交过的周次决策会显示在这里，方便对比复盘。
        </p>
      </div>
    );
  }

  const weekMeta = WEEKS.find((w) => w.key === selectedWeek);
  const weekResult = cycleResult.weeks.find((w) => w.weekKey === selectedWeek);
  const weekDecision = payload.weeks[selectedWeek];
  if (!weekMeta || !weekResult || !weekDecision) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-700 mb-1">暂无数据</h3>
        <p className="text-sm text-slate-400">该轮次暂无复盘数据。</p>
      </div>
    );
  }

  // Find previous submitted week for comparison
  const submittedKeys = submittedWeekList.map((w) => w.key);
  const currentIdx = submittedKeys.indexOf(selectedWeek);
  const prevWeekKey = currentIdx > 0 ? submittedKeys[currentIdx - 1] : null;
  const prevWeekResult = prevWeekKey
    ? cycleResult.weeks.find((w) => w.weekKey === prevWeekKey)
    : null;

  // Per-channel breakdown for selected week
  const channelRows = [...weekResult.channels].sort((a, b) => b.netRevenue - a.netRevenue);

  return (
    <div className="space-y-5">
      {/* Week selector chips */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-slate-800">选择复盘轮次</h3>
          <span className="text-xs text-slate-400">已提交 {submittedWeekList.length} 周</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {submittedWeekList.map((w) => {
            const wr = cycleResult.weeks.find((x) => x.weekKey === w.key)!;
            const isSelected = w.key === selectedWeek;
            return (
              <button
                key={w.key}
                onClick={() => setSelectedWeek(w.key)}
                className={cn(
                  'px-3 py-2 rounded-lg text-sm font-medium transition border',
                  isSelected
                    ? 'bg-indigo-500 text-white border-indigo-500 shadow'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50',
                )}
              >
                <div className="flex items-center gap-2">
                  <span>第{w.index}周</span>
                  <span className={cn('text-xs', isSelected ? 'text-indigo-100' : 'text-slate-400')}>
                    ¥{Math.round(wr.netRevenue).toLocaleString()}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Key metrics with comparison */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HistoryMetric
          label="净营收"
          value={fmtMoney(weekResult.netRevenue)}
          prev={prevWeekResult ? fmtMoney(prevWeekResult.netRevenue) : null}
          diff={prevWeekResult ? weekResult.netRevenue - prevWeekResult.netRevenue : null}
        />
        <HistoryMetric
          label="毛营收"
          value={fmtMoney(weekResult.grossRevenue)}
          prev={prevWeekResult ? fmtMoney(prevWeekResult.grossRevenue) : null}
          diff={prevWeekResult ? weekResult.grossRevenue - prevWeekResult.grossRevenue : null}
        />
        <HistoryMetric
          label="出租率"
          value={fmtPct(weekResult.occupancy)}
          prev={prevWeekResult ? fmtPct(prevWeekResult.occupancy) : null}
          diff={prevWeekResult ? weekResult.occupancy - prevWeekResult.occupancy : null}
          isPct
        />
        <HistoryMetric
          label="RevPAR"
          value={`¥${weekResult.revpar.toFixed(1)}`}
          prev={prevWeekResult ? `¥${prevWeekResult.revpar.toFixed(1)}` : null}
          diff={prevWeekResult ? weekResult.revpar - prevWeekResult.revpar : null}
        />
      </div>

      {/* Decision detail + result side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Decision table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h4 className="text-sm font-semibold text-slate-700">
              第{weekMeta.index}周决策明细
              <span className="ml-2 text-xs font-normal text-slate-400">{weekMeta.label}</span>
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-3 py-2 font-medium text-slate-600">渠道</th>
                  <th className="text-center px-2 py-2 font-medium text-slate-600">房型</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-600">定价</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-600">配额</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-600">净营收</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {weekResult.channels.map((ch) =>
                  ch.roomTypes.map((rt, rtIdx) => (
                    <tr key={ch.channelKey + rt.roomTypeKey} className="hover:bg-slate-50/50">
                      {rtIdx === 0 && (
                        <td
                          rowSpan={ch.roomTypes.length}
                          className="px-3 py-2 font-medium text-slate-700 align-top"
                        >
                          {ch.channelName}
                        </td>
                      )}
                      <td className="px-2 py-2 text-center text-slate-500">{rt.roomTypeName}</td>
                      <td className="px-2 py-2 text-right text-slate-600">
                        ¥{weekDecision.channels[ch.channelKey].roomTypes[rt.roomTypeKey].price}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600">
                        {weekDecision.channels[ch.channelKey].roomTypes[rt.roomTypeKey].quota}间
                      </td>
                      <td className="px-2 py-2 text-right font-medium text-slate-700">
                        ¥{Math.round(rt.netRevenue).toLocaleString()}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Channel performance ranking */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h4 className="text-sm font-semibold text-slate-700">渠道收益排名</h4>
          </div>
          <div className="p-4 space-y-3">
            {channelRows.map((ch, i) => {
              const maxRev = channelRows[0].netRevenue || 1;
              const pct = (ch.netRevenue / maxRev) * 100;
              return (
                <div key={ch.channelKey}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">
                      <span className="text-slate-400 mr-1.5">#{i + 1}</span>
                      {ch.channelName}
                    </span>
                    <span className="font-semibold text-slate-800">
                      ¥{Math.round(ch.netRevenue).toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-400 to-indigo-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                    <span>佣金 ¥{Math.round(ch.commission).toLocaleString()}</span>
                    <span>间夜 {ch.roomNights}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Special factors applied */}
      {weekDecision.specialFactors.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-4 h-4 text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-800">本周特殊因素</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {weekDecision.specialFactors.map((fk) => {
              const meta = SPECIAL_FACTORS.find((s) => s.key === fk);
              if (!meta) return null;
              const Icon = FACTOR_ICONS[fk] || Info;
              return (
                <span
                  key={fk}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-indigo-200 rounded-lg text-xs text-indigo-700"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {meta.name}
                  <span className="text-indigo-400">×{meta.demandMultiplier}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Cross-week trend mini chart */}
      {submittedWeekList.length >= 2 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h4 className="text-sm font-semibold text-slate-700 mb-4">各周净营收趋势</h4>
          <WeekTrendChart
            weeks={submittedWeekList.map((w) => ({
              key: w.key,
              index: w.index,
              label: w.label,
              netRevenue: cycleResult.weeks.find((x) => x.weekKey === w.key)!.netRevenue,
            }))}
            selectedKey={selectedWeek}
            onSelect={setSelectedWeek}
          />
        </div>
      )}
    </div>
  );
}

function HistoryMetric({
  label,
  value,
  prev,
  diff,
  isPct,
}: {
  label: string;
  value: string;
  prev: string | null;
  diff: number | null;
  isPct?: boolean;
}) {
  const up = diff !== null && diff > 0;
  const down = diff !== null && diff < 0;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-slate-800">{value}</div>
      {prev !== null && (
        <div className="mt-1.5 flex items-center gap-1 text-xs">
          <span className="text-slate-400">上轮 {prev}</span>
          {diff !== null && diff !== 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium px-1.5 py-0.5 rounded',
                up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600',
              )}
            >
              {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {isPct ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}pp` : `${diff > 0 ? '+' : ''}${fmtMoney(diff)}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function WeekTrendChart({
  weeks,
  selectedKey,
  onSelect,
}: {
  weeks: { key: string; index: number; label: string; netRevenue: number }[];
  selectedKey: string;
  onSelect: (k: string) => void;
}) {
  const max = Math.max(...weeks.map((w) => w.netRevenue), 1);
  const min = Math.min(...weeks.map((w) => w.netRevenue), 0);
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-3 h-40">
      {weeks.map((w) => {
        const heightPct = ((w.netRevenue - min) / range) * 70 + 20;
        const isSelected = w.key === selectedKey;
        return (
          <button
            key={w.key}
            onClick={() => onSelect(w.key)}
            className="flex-1 flex flex-col items-center gap-1.5 group"
          >
            <span className={cn('text-xs font-semibold', isSelected ? 'text-indigo-600' : 'text-slate-400')}>
              ¥{Math.round(w.netRevenue).toLocaleString()}
            </span>
            <div className="w-full flex-1 flex items-end">
              <div
                className={cn(
                  'w-full rounded-t-lg transition-all group-hover:opacity-80',
                  isSelected ? 'bg-indigo-500' : 'bg-indigo-200',
                )}
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <span className={cn('text-xs', isSelected ? 'text-indigo-600 font-medium' : 'text-slate-400')}>
              W{w.index}
            </span>
          </button>
        );
      })}
    </div>
  );
}
