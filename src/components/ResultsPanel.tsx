import { useState } from 'react';
import { TrendingUp, DollarSign, BedDouble, Percent, AlertTriangle, Sparkles, Eye } from 'lucide-react';
import type { CycleResult, WeekResult, RoomTypeMeta } from '../types';
import { fmtMoney, fmtPct, fmtNum, cn } from '../utils';

interface Props {
  result: CycleResult;
  roomTypes?: RoomTypeMeta[];
}

export default function ResultsPanel({ result, roomTypes }: Props) {
  const rts = roomTypes ?? [];
  return (
    <div className="space-y-5">
      {/* Overall KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Percent}
          label="全周期总出租率"
          value={fmtPct(result.overallOccupancy)}
          gradient="from-blue-500 to-blue-600"
        />
        <KpiCard
          icon={TrendingUp}
          label="全周期RevPAR"
          value={fmtMoney(result.overallRevpar)}
          gradient="from-emerald-500 to-emerald-600"
        />
        <KpiCard
          icon={BedDouble}
          label="总出租间夜数"
          value={fmtNum(result.totalRoomNights)}
          sub={`/${fmtNum(result.totalRoomNightsAvailable)} 可售`}
          gradient="from-slate-600 to-slate-700"
        />
        <KpiCard
          icon={DollarSign}
          label="总净贡献"
          value={fmtMoney(result.totalNetContribution)}
          sub={`毛额 ${fmtMoney(result.totalGrossRevenue)}`}
          gradient="from-amber-500 to-amber-600"
        />
      </div>

      {/* Cost breakdown banner */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-xl p-5 text-white shadow-md">
        <h3 className="text-sm font-semibold mb-4">渠道成本与净贡献分析</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <div className="text-xs text-slate-400 mb-1">毛营收</div>
            <div className="text-lg font-bold">{fmtMoney(result.totalGrossRevenue)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">佣金成本</div>
            <div className="text-lg font-bold text-red-400">-{fmtMoney(result.totalCommission)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">内容/投流成本</div>
            <div className="text-lg font-bold text-orange-400">-{fmtMoney(result.totalContentCost)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">净贡献</div>
            <div className="text-lg font-bold text-amber-400">{fmtMoney(result.totalNetContribution)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">潜在长尾价值</div>
            <div className="text-lg font-bold text-sky-400">{fmtMoney(result.potentialLongTailValue)}</div>
          </div>
        </div>
        {result.potentialLongTailValue > 0 && (
          <div className="text-xs text-slate-400 mt-3">
            潜在长尾价值为沙盒结束时仍未确认的待释放间夜，不计入排名
          </div>
        )}
      </div>

      {/* Weekly summary table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">各周预估汇总</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <th className="text-left px-4 py-2.5 font-medium">周次</th>
                <th className="text-left px-4 py-2.5 font-medium">日期</th>
                <th className="text-right px-3 py-2.5 font-medium">天数</th>
                <th className="text-right px-3 py-2.5 font-medium">间夜数</th>
                <th className="text-right px-3 py-2.5 font-medium">出租率</th>
                <th className="text-right px-3 py-2.5 font-medium">RevPAR</th>
                <th className="text-right px-3 py-2.5 font-medium">毛营收</th>
                <th className="text-right px-3 py-2.5 font-medium">佣金</th>
                <th className="text-right px-3 py-2.5 font-medium">内容成本</th>
                <th className="text-right px-4 py-2.5 font-medium">净贡献</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.weeks.map((w) => (
                <tr key={w.weekKey} className="hover:bg-slate-50/50 transition">
                  <td className="px-4 py-2.5 font-medium text-slate-700">{weekLabel(w.weekKey)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{w.weekLabel}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{w.days}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{fmtNum(w.totalRoomNights)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{fmtPct(w.occupancy)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{fmtMoney(w.revpar)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{fmtMoney(w.grossRevenue)}</td>
                  <td className="px-3 py-2.5 text-right text-red-500">{w.totalCommission > 0 ? `-${fmtMoney(w.totalCommission)}` : '-'}</td>
                  <td className="px-3 py-2.5 text-right text-orange-500">{w.totalContentCost > 0 ? `-${fmtMoney(w.totalContentCost)}` : '-'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-amber-600">{fmtMoney(w.totalNetContribution)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800">
                <td className="px-4 py-3" colSpan={2}>合计</td>
                <td className="px-3 py-3 text-right">{result.weeks.reduce((s, w) => s + w.days, 0)}</td>
                <td className="px-3 py-3 text-right">{fmtNum(result.totalRoomNights)}</td>
                <td className="px-3 py-3 text-right">{fmtPct(result.overallOccupancy)}</td>
                <td className="px-3 py-3 text-right">{fmtMoney(result.overallRevpar)}</td>
                <td className="px-3 py-3 text-right">{fmtMoney(result.totalGrossRevenue)}</td>
                <td className="px-3 py-3 text-right text-red-500">-{fmtMoney(result.totalCommission)}</td>
                <td className="px-3 py-3 text-right text-orange-500">-{fmtMoney(result.totalContentCost)}</td>
                <td className="px-4 py-3 text-right text-amber-600">{fmtMoney(result.totalNetContribution)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Room type summary */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">各房型营收占比</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-x divide-slate-100">
          {rts.map((rt) => {
            const rtNet = result.weeks.reduce(
              (s, w) => s + (w.roomTypes.find((r) => r.roomTypeKey === rt.key)?.netRevenue ?? 0),
              0,
            );
            const rtNights = result.weeks.reduce(
              (s, w) => s + (w.roomTypes.find((r) => r.roomTypeKey === rt.key)?.roomNights ?? 0),
              0,
            );
            const pct = result.totalNetRevenue > 0 ? (rtNet / result.totalNetRevenue) * 100 : 0;
            return (
              <div key={rt.key} className="p-5">
                <div className="text-sm font-medium text-slate-700">{rt.name}</div>
                <div className="text-xs text-slate-400 mb-2">{rt.inventory}间 · {fmtNum(rtNights)} 间夜</div>
                <div className="text-2xl font-bold text-slate-800">{fmtMoney(rtNet)}</div>
                <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-slate-400 mt-1">占净营收 {pct.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-week channel detail with M7 visualization */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">各周渠道效果明细</h3>
          <p className="text-xs text-slate-400 mt-1">投放配额 ≠ 实际成交 · 含转化率/流量上限/内容成本/净贡献</p>
        </div>
        <div className="divide-y divide-slate-100">
          {result.weeks.map((w) => (
            <WeekChannelDetail key={w.weekKey} week={w} />
          ))}
        </div>
      </div>
    </div>
  );
}

function weekLabel(key: string): string {
  const m = key.match(/^wk(\d+)$/);
  return m ? `第${m[1]}周` : key;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  gradient,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  gradient: string;
}) {
  return (
    <div className={cn('rounded-xl p-5 text-white shadow-md bg-gradient-to-br', gradient)}>
      <Icon className="w-6 h-6 mb-3 opacity-80" />
      <div className="text-xs opacity-80 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-70 mt-1">{sub}</div>}
    </div>
  );
}

function WeekChannelDetail({ week }: { week: WeekResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-800">{weekLabel(week.weekKey)}</span>
          <span className="text-xs text-slate-400">{week.weekLabel}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">出租率 {fmtPct(week.occupancy)}</span>
          <span className="font-semibold text-amber-600">净贡献 {fmtMoney(week.totalNetContribution)}</span>
          <span className={cn('text-slate-400 transition-transform', open && 'rotate-180')}>▾</span>
        </div>
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left py-2 font-medium">渠道</th>
                <th className="text-right py-2 font-medium">投放配额</th>
                <th className="text-right py-2 font-medium">曝光量</th>
                <th className="text-right py-2 font-medium">点击率</th>
                <th className="text-right py-2 font-medium">转化率</th>
                <th className="text-right py-2 font-medium">已确认间夜</th>
                <th className="text-right py-2 font-medium">待释放间夜</th>
                <th className="text-right py-2 font-medium">佣金</th>
                <th className="text-right py-2 font-medium">内容成本</th>
                <th className="text-right py-2 font-medium">总渠道成本</th>
                <th className="text-right py-2 font-medium">净贡献</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {week.channels.map((c) => (
                <tr
                  key={c.channelKey}
                  className={cn(
                    c.confirmedRoomNights === 0 && 'opacity-40',
                    c.quotaExceedsCap && 'bg-red-50/60',
                  )}
                >
                  <td className="py-2 text-slate-700 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {c.channelName}
                      {c.isViral && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-orange-600 bg-orange-100 px-1 py-0.5 rounded-full font-medium">
                          <Sparkles className="w-2.5 h-2.5" /> 爆款
                        </span>
                      )}
                    </div>
                    {c.quotaExceedsCap && (
                      <div className="flex items-center gap-0.5 text-[10px] text-red-600 mt-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" /> 超流量上限
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-right text-slate-600">{fmtNum(c.allocatedQuota)}</td>
                  <td className="py-2 text-right text-slate-500">
                    <span className="inline-flex items-center gap-0.5 text-slate-400">
                      <Eye className="w-3 h-3" />
                      {c.impressions > 0 ? fmtNum(c.impressions) : '-'}
                    </span>
                  </td>
                  <td className="py-2 text-right text-slate-600">{c.clickRate > 0 ? fmtPct(c.clickRate) : '-'}</td>
                  <td className="py-2 text-right text-slate-600">{c.conversionRate > 0 ? fmtPct(c.conversionRate) : '-'}</td>
                  <td className="py-2 text-right font-medium text-slate-700">{fmtNum(c.confirmedRoomNights)}</td>
                  <td className="py-2 text-right text-sky-600">{c.pendingRoomNights > 0 ? fmtNum(c.pendingRoomNights) : '-'}</td>
                  <td className="py-2 text-right text-red-500">{c.commission > 0 ? `-${fmtMoney(c.commission)}` : '-'}</td>
                  <td className="py-2 text-right text-orange-500">{c.contentCost > 0 ? `-${fmtMoney(c.contentCost)}` : '-'}</td>
                  <td className="py-2 text-right text-slate-600">{c.totalCost > 0 ? fmtMoney(c.totalCost) : '-'}</td>
                  <td className="py-2 text-right font-semibold text-amber-600">{fmtMoney(c.netContribution)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
