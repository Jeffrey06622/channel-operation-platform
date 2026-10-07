import type { BaseParams, CycleResult, DecisionRow, GroupRow, WeekSubmissionRow } from './types';
import { WEEKS } from './domain';
import { computeCycle } from './calc';

export interface ExportRow {
  rank: number;
  classLabel: string;
  groupName: string;
  occupancy: number;
  adr: number;
  revpar: number;
  grossRevenue: number;
  totalCommission: number;
  contentCost: number;
  netRevenue: number;
  netContribution: number;
  potentialLongTail: number;
  weekStatuses: Record<string, string>;
}

function cycleSummary(cycle: CycleResult) {
  const adr =
    cycle.totalRoomNights > 0
      ? cycle.totalGrossRevenue / cycle.totalRoomNights
      : 0;
  return {
    occupancy: cycle.overallOccupancy,
    adr,
    revpar: cycle.overallRevpar,
    grossRevenue: cycle.totalGrossRevenue,
    totalCommission: cycle.totalCommission,
    contentCost: cycle.totalContentCost,
    netRevenue: cycle.totalNetRevenue,
    netContribution: cycle.totalNetContribution,
    potentialLongTail: cycle.potentialLongTailValue,
  };
}

export function buildExportRows(
  groups: GroupRow[],
  decisions: DecisionRow[],
  baseParams: BaseParams | null,
  weekSubmissions: WeekSubmissionRow[] = [],
  simConfig?: import('./types').ChannelSimConfig | null,
): ExportRow[] {
  const decisionMap = new Map<string, DecisionRow>();
  for (const d of decisions) decisionMap.set(d.group_id, d);

  const subMap = new Map<string, Map<string, WeekSubmissionRow>>();
  for (const s of weekSubmissions) {
    if (!subMap.has(s.group_id)) subMap.set(s.group_id, new Map());
    subMap.get(s.group_id)!.set(s.week_key, s);
  }

  const rows: ExportRow[] = groups.map((g) => {
    const d = decisionMap.get(g.id);
    const cycle = d ? computeCycle(d.payload, baseParams, simConfig, g.id) : null;
    const s = cycle
      ? cycleSummary(cycle)
      : { occupancy: 0, adr: 0, revpar: 0, grossRevenue: 0, totalCommission: 0, contentCost: 0, netRevenue: -Infinity, netContribution: -Infinity, potentialLongTail: 0 };
    const groupSubs = subMap.get(g.id) ?? new Map();
    const weekStatuses: Record<string, string> = {};
    for (const w of WEEKS) {
      const sub = groupSubs.get(w.key);
      if (sub) {
        weekStatuses[w.key] = sub.submission_status === 'late' ? '逾期补交' : '按时提交';
      } else {
        weekStatuses[w.key] = '未提交';
      }
    }
    return {
      rank: 0,
      classLabel: g.class_label || '',
      groupName: g.name,
      occupancy: s.occupancy,
      adr: s.adr,
      revpar: s.revpar,
      grossRevenue: s.grossRevenue,
      totalCommission: s.totalCommission,
      contentCost: s.contentCost,
      netRevenue: s.netRevenue,
      netContribution: s.netContribution,
      potentialLongTail: s.potentialLongTail,
      weekStatuses,
    };
  });

  rows.sort((a, b) => b.netContribution - a.netContribution);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

function esc(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function row(values: (string | number)[]): string {
  return values.map(esc).join(',') + '\n';
}

export function rowsToCsv(rows: ExportRow[]): string {
  const baseHeaders = [
    '排名',
    '班级',
    '小组名称',
    '出租率',
    'ADR',
    'RevPAR',
    '总营收',
    '总佣金成本',
    '内容投流成本',
    '净营收',
    '净贡献',
    '潜在长尾价值',
  ];
  const weekHeaders = WEEKS.map((w) => `第${w.index}周状态`);
  const headers = [...baseHeaders, ...weekHeaders];
  let out = row(headers);
  for (const r of rows) {
    const weekValues = WEEKS.map((w) => r.weekStatuses[w.key] ?? '未提交');
    out += row([
      r.rank,
      r.classLabel,
      r.groupName,
      (r.occupancy * 100).toFixed(2) + '%',
      r.adr.toFixed(2),
      r.revpar.toFixed(2),
      r.grossRevenue.toFixed(2),
      r.totalCommission.toFixed(2),
      r.contentCost.toFixed(2),
      r.netRevenue.toFixed(2),
      r.netContribution.toFixed(2),
      r.potentialLongTail.toFixed(2),
      ...weekValues,
    ]);
  }
  return out;
}

export function downloadCsv(filename: string, csv: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
