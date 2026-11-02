import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  buildResponseMatrix,
  categoryLabel,
  expectedResponseLabel,
  isFactorEffective,
} from '../specialDemand';
import type {
  BaseParams,
  CompareStatus,
  DecisionRow,
  FactorResponseMatrix,
  GroupRow,
  ResponseStatus,
  SpecialDemandFactor,
  WeekMeta,
} from '../types';
import { cn } from '../utils';

interface Props {
  factors: SpecialDemandFactor[];
  week: WeekMeta;
  groups: GroupRow[];
  decisionMap: Map<string, DecisionRow>;
  baseParams: BaseParams | null;
}

type StatusFilter = 'all' | ResponseStatus;

const STATUS_LABEL: Record<ResponseStatus, string> = {
  responded: '已应变',
  not_responded: '未应变',
  no_data: '未提交',
};

const STATUS_CLASS: Record<ResponseStatus, string> = {
  responded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  not_responded: 'bg-rose-50 text-rose-700 border-rose-200',
  no_data: 'bg-slate-100 text-slate-500 border-slate-200',
};

const COMPARE_LABEL: Record<CompareStatus, string> = {
  leading: '领先',
  on_par: '持平',
  lagging: '落后',
  no_data: '—',
};

const COMPARE_CLASS: Record<CompareStatus, string> = {
  leading: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  on_par: 'bg-slate-100 text-slate-600 border-slate-200',
  lagging: 'bg-amber-50 text-amber-700 border-amber-200',
  no_data: 'bg-white text-slate-400 border-slate-200',
};

const CSV_HEADERS = ['因素名称', '类别', '预期应对', '触发条件', '小组', '班级', '应变状态', '指标值', '对比', '说明'];

function csvCell(value: string): string {
  const guarded = /^[=@+\-]/.test(value) && !/^[+-]?\d/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function exportCsv(matrices: FactorResponseMatrix[], weekKey: string) {
  const lines = [CSV_HEADERS.map(csvCell).join(',')];
  for (const m of matrices) {
    for (const r of m.rows) {
      lines.push(
        [
          m.factor.name,
          categoryLabel(m.factor.category),
          expectedResponseLabel(m.factor.expected_response),
          m.trigger_text,
          r.group_name,
          r.class_label,
          STATUS_LABEL[r.status],
          r.metric_value == null ? '' : r.metric_value.toFixed(1),
          COMPARE_LABEL[r.compare],
          r.detail,
        ]
          .map((v) => csvCell(String(v)))
          .join(','),
      );
    }
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `应变矩阵_${weekKey}_${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function SpecialDemandMatrix({ factors, week, groups, decisionMap, baseParams }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [classFilter, setClassFilter] = useState('all');

  const effective = useMemo(
    () => factors.filter((f) => f.is_active && isFactorEffective(f, week)),
    [factors, week],
  );

  const matrices = useMemo(
    () => buildResponseMatrix(effective, groups, decisionMap, week, baseParams),
    [effective, groups, decisionMap, week, baseParams],
  );

  const classes = useMemo(
    () => Array.from(new Set(groups.map((g) => g.class_label).filter(Boolean))).sort(),
    [groups],
  );

  const visible = useMemo(
    () =>
      matrices.map((m) => ({
        ...m,
        rows: m.rows.filter(
          (r) =>
            (statusFilter === 'all' || r.status === statusFilter) &&
            (classFilter === 'all' || r.class_label === classFilter),
        ),
      })),
    [matrices, statusFilter, classFilter],
  );

  const totalPairs = matrices.length * groups.length;
  const respondedPairs = matrices.reduce((s, m) => s + m.responded_count, 0);
  const rate = totalPairs > 0 ? Math.round((respondedPairs / totalPairs) * 100) : 0;
  const visibleRowCount = visible.reduce((s, m) => s + m.rows.length, 0);

  if (effective.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">
        第{week.index}周没有生效的特殊需求因素
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid grid-cols-3 gap-3 flex-1 min-w-[280px] max-w-xl">
          <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[11px] text-slate-500">生效因素</p>
            <p className="text-lg font-semibold text-slate-800">{effective.length}</p>
          </div>
          <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[11px] text-slate-500">应变覆盖率</p>
            <p className="text-lg font-semibold text-slate-800">{rate}%</p>
          </div>
          <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[11px] text-slate-500">已应变 / 总数</p>
            <p className="text-lg font-semibold text-slate-800">
              {respondedPairs} / {totalPairs}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => exportCsv(visible, week.key)}
          disabled={visibleRowCount === 0}
          title="导出当前筛选结果"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700 disabled:opacity-40 transition-colors"
        >
          <Download className="w-4 h-4" />
          导出 CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              ['all', '全部'],
              ['responded', '已应变'],
              ['not_responded', '未应变'],
              ['no_data', '未提交'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                statusFilter === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        >
          <option value="all">全部班级</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {visible.map((m) => (
        <div key={m.factor.id} className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{m.factor.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-slate-600">
                  {categoryLabel(m.factor.category)}
                </span>
                <span className="text-xs font-semibold text-slate-600">×{m.factor.demand_multiplier.toFixed(2)}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {expectedResponseLabel(m.factor.expected_response)}｜{m.trigger_text}
              </p>
            </div>
            <div className="text-xs text-slate-600 text-right">
              <p>
                已应变 <span className="font-semibold text-slate-800">{m.responded_count}</span> / {m.total_groups} 组
              </p>
              <p className="text-slate-400">中位数 {m.median == null ? '—' : m.median.toFixed(1)}</p>
            </div>
          </div>
          {m.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">没有符合筛选条件的小组</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2 font-medium">小组</th>
                    <th className="px-4 py-2 font-medium">班级</th>
                    <th className="px-4 py-2 font-medium">应变状态</th>
                    <th className="px-4 py-2 font-medium">指标值</th>
                    <th className="px-4 py-2 font-medium">对比</th>
                    <th className="px-4 py-2 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {m.rows.map((r) => (
                    <tr key={r.group_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-2 text-slate-800">{r.group_name}</td>
                      <td className="px-4 py-2 text-slate-600">{r.class_label}</td>
                      <td className="px-4 py-2">
                        <span className={cn('px-2 py-0.5 rounded-full border text-xs', STATUS_CLASS[r.status])}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2 tabular-nums text-slate-700">
                        {r.metric_value == null ? '—' : r.metric_value.toFixed(1)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn('px-2 py-0.5 rounded-full border text-xs', COMPARE_CLASS[r.compare])}>
                          {COMPARE_LABEL[r.compare]}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
