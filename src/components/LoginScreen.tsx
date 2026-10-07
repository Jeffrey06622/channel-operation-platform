import { useState, useEffect, useCallback } from 'react';
import { Hotel, KeyRound, GraduationCap, Users, Lock, BookOpen, Eye, EyeOff, Loader2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { supabaseFetch, isNetworkError } from '../supabaseRequest';
import { verifyPassword, verifyTeacherPassword } from '../auth';
import type { GroupRow } from '../types';
import { cn } from '../utils';

const CLASS_OPTIONS = ['酒管25088', '酒管25089', '酒管25090', '酒管25091'];

interface Props {
  onGroupLogin: (group: GroupRow) => void;
  onTeacherLogin: () => void;
}

export default function LoginScreen({ onGroupLogin, onTeacherLogin }: Props) {
  const [mode, setMode] = useState<'group' | 'teacher'>('group');
  const [classLabel, setClassLabel] = useState('');
  const [groupList, setGroupList] = useState<GroupRow[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupPassword, setGroupPassword] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('');
  const [showGroupPwd, setShowGroupPwd] = useState(false);
  const [showTeacherPwd, setShowTeacherPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const fetchGroups = useCallback(async (cls: string) => {
    if (!cls) { setGroupList([]); return; }
    setLoadingGroups(true);
    try {
      const { data, error: qErr } = await supabaseFetch(() =>
        supabase
          .from('groups')
          .select('*')
          .eq('class_label', cls)
          .order('name'),
      );
      if (qErr) throw qErr;
      setGroupList((data as GroupRow[]) || []);
    } catch (err) {
      setGroupList([]);
      if (isNetworkError(err)) {
        setError('网络不佳，请检查网络后重试');
      }
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'group' && classLabel) {
      setConnecting(true);
      fetchGroups(classLabel).finally(() => setConnecting(false));
    } else {
      setGroupList([]);
    }
    setGroupName('');
  }, [classLabel, mode, fetchGroups]);

  async function handleGroupLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!classLabel) {
      setError('请选择班级');
      return;
    }
    if (!groupName) {
      setError('请选择小组');
      return;
    }
    if (!groupPassword) {
      setError('请输入小组密码');
      return;
    }
    setLoading(true);
    try {
      const selected = groupList.find((g) => g.name === groupName);
      if (!selected) {
        setError('请选择有效的小组');
        setLoading(false);
        return;
      }
      const { data, error: qErr } = await supabaseFetch(() =>
        supabase
          .from('groups')
          .select('*')
          .eq('id', selected.id)
          .maybeSingle(),
      );
      if (qErr) throw qErr;
      if (!data) {
        setError('未找到此小组，请联系老师');
        setLoading(false);
        return;
      }
      const ok = await verifyPassword(groupPassword, data.password_hash);
      if (!ok) {
        setError('密码错误');
        setLoading(false);
        return;
      }
      onGroupLogin(data as GroupRow);
    } catch (err) {
      if (isNetworkError(err)) {
        setError('网络不佳，请检查网络后重试');
      } else {
        setError(err instanceof Error ? err.message : '登录失败');
      }
      setLoading(false);
    }
  }

  async function handleTeacherLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!teacherPassword) {
      setError('请输入教师密码');
      return;
    }
    setLoading(true);
    try {
      const { data, error: qErr } = await supabaseFetch(() =>
        supabase
          .from('app_settings')
          .select('teacher_password_hash')
          .limit(1)
          .maybeSingle(),
      );
      if (qErr) throw qErr;
      const storedHash = data?.teacher_password_hash ?? '';
      const ok = await verifyTeacherPassword(teacherPassword, storedHash);
      if (ok) {
        onTeacherLogin();
      } else {
        setError('教师密码错误');
      }
    } catch (err) {
      if (isNetworkError(err)) {
        setError('网络不佳，请检查网络后重试');
      } else {
        setError(err instanceof Error ? err.message : '登录失败');
      }
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/20 mb-4">
            <Hotel className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            酒店渠道运营决策实训平台
          </h1>
          <p className="text-sm text-amber-300/80 mt-2 tracking-wide">
            《酒店渠道运营策略》课程专用实训平台
          </p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 shadow-2xl">
          <div className="flex gap-2 mb-6 p-1 bg-slate-800/50 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setMode('group');
                setError('');
              }}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all',
                mode === 'group'
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                  : 'text-slate-400 hover:text-white',
              )}
            >
              <Users className="w-4 h-4" />
              小组登录
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('teacher');
                setError('');
              }}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all',
                mode === 'teacher'
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                  : 'text-slate-400 hover:text-white',
              )}
            >
              <GraduationCap className="w-4 h-4" />
              教师登录
            </button>
          </div>

          {mode === 'group' ? (
            <form onSubmit={handleGroupLogin} className="space-y-4" autoComplete="on">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  班级
                </label>
                <div className="relative">
                  <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none z-10" />
                  <select
                    value={classLabel}
                    onChange={(e) => setClassLabel(e.target.value)}
                    className={cn(
                      'w-full pl-10 pr-4 py-2.5 bg-slate-800/60 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition appearance-none cursor-pointer',
                      classLabel ? 'text-white' : 'text-slate-500',
                    )}
                  >
                    <option value="" disabled className="bg-slate-800 text-slate-400">
                      请选择班级
                    </option>
                    {CLASS_OPTIONS.map((c) => (
                      <option key={c} value={c} className="bg-slate-800 text-white">
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  小组名称
                </label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none z-10" />
                  <select
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    disabled={!classLabel || loadingGroups}
                    className={cn(
                      'w-full pl-10 pr-4 py-2.5 bg-slate-800/60 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition appearance-none cursor-pointer',
                      classLabel ? 'text-white' : 'text-slate-600',
                      !classLabel && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <option value="" disabled className="bg-slate-800 text-slate-400">
                      {!classLabel
                        ? '请先选择班级'
                        : loadingGroups
                          ? '正在加载小组列表...'
                          : groupList.length === 0
                            ? '该班级暂无小组'
                            : '请选择小组'}
                    </option>
                    {groupList.map((g) => (
                      <option key={g.id} value={g.name} className="bg-slate-800 text-white">
                        {g.name}
                      </option>
                    ))}
                  </select>
                  {loadingGroups && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400 animate-spin" />
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  小组密码
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showGroupPwd ? 'text' : 'password'}
                    value={groupPassword}
                    onChange={(e) => setGroupPassword(e.target.value)}
                    placeholder="输入小组密码"
                    autoComplete="current-password"
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-800/60 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGroupPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                    aria-label={showGroupPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showGroupPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <p className="text-xs text-amber-300">
                    初始密码统一为 <span className="font-semibold tracking-widest">000000</span>，登录后请及时修改
                  </p>
                </div>
              </div>
              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              {connecting && (
                <div className="flex items-center gap-2 text-xs text-amber-300/70">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在连接服务器...
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {loading ? '登录中...' : '进入决策填写'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleTeacherLogin} className="space-y-4" autoComplete="on">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  教师密码
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showTeacherPwd ? 'text' : 'password'}
                    value={teacherPassword}
                    onChange={(e) => setTeacherPassword(e.target.value)}
                    placeholder="输入教师密码"
                    autoComplete="current-password"
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-800/60 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTeacherPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                    aria-label={showTeacherPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showTeacherPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  默认密码：teacher2024，登录后可自行修改
                </p>
              </div>
              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-medium rounded-lg hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {loading ? '验证中...' : '进入教师后台'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
