import { ta } from '../i18n.js';
import { useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import { TRACE_KINDS, TRACE_PHASES } from '../core/trace-types.js';
import {
  compareSideStats,
  compareActivity,
  eventKindCounts,
  phaseDurations,
} from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import { TokenTextModal, type TokenClass } from './TokenTextModal.js';
import { RadarChart as RadarChartBase } from './charts/RadarChart.js';
import { CompareTokenUsage } from './CompareTokenUsage.js';
import { scanTimingReason } from '../core/scan-timing.js';
import type { ScanTimingMetric } from '../core/scan-timing.js';

/** Recorded magnitudes, not capability scores. Missing axes are never zero-filled. */
export function RadarChart({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const speed = result.speed;
  const ls = compareSideStats(leftEvents, speed.left, result.left.session);
  const rs = compareSideStats(rightEvents, speed.right, result.right.session);
  const la = compareActivity(result.left);
  const ra = compareActivity(result.right);
  const avgTool = (events: TraceEventSlim[]): number | null => {
    const tools = events.filter((e) => e.tool !== null);
    return tools.length === 0 || tools.some(event=>!Number.isFinite(event.durationMs)||event.durationMs<0) ? null : tools.reduce((sum, e) => sum + e.durationMs, 0) / tools.length;
  };
  const defs: Array<{label:string;lv:number|null;rv:number|null;timing?:ScanTimingMetric;eventDerived?:boolean;unit?:string}> = [
    {label:t('compare.profile.wallClock',locale),lv:speed.left.e2eMs,rv:speed.right.e2eMs,timing:'e2e',unit:'ms'},
    {label:t('session.tokens',locale),lv:result.left.pending?null:result.left.session.tokenUsage.total,rv:result.right.pending?null:result.right.session.tokenUsage.total},
    {label:t('compare.profile.toolInterval',locale),lv:avgTool(leftEvents),rv:avgTool(rightEvents),timing:'eventDuration',eventDerived:true,unit:'ms'},
    {label:'TPS',lv:speed.left.tps,rv:speed.right.tps,timing:'tps',eventDerived:true},
    {label:t('compare.radar.write',locale),lv:ls.fileWrites,rv:rs.fileWrites,eventDerived:true},
    {label:t('compare.radar.read',locale),lv:ls.fileReads,rv:rs.fileReads,eventDerived:true},
    {label:t('compare.activity.errorSteps',locale),lv:la.errorRate,rv:ra.errorRate,eventDerived:true},
    {label:t('compare.activity.verification',locale),lv:la.verification,rv:ra.verification,eventDerived:true},
  ];
  const finite=(value:number|null):number|null=>value!==null&&Number.isFinite(value)&&value>=0?value:null;
  const axes=defs.map(def=>{
    const lv=finite(def.eventDerived&&!la.complete?null:def.lv);
    const rv=finite(def.eventDerived&&!ra.complete?null:def.rv);
    const reason=def.eventDerived&&(!la.complete||!ra.complete)?'partial_evidence':def.timing?scanTimingReason(result.left,result.right,def.timing,lv,rv):lv===null||rv===null?'missing_value':null;
    const max=lv===null||rv===null?null:Math.max(lv,rv);
    return {...def,lv,rv,reason,max,l:max===null||max===0?0:lv!/max,r:max===null||max===0?0:rv!/max};
  });
  const available=axes.filter(axis=>axis.reason===null);
  const omitted = axes.filter(axis => axis.reason !== null);
  const fmt=(value:number|null,unit?:string):string=>value===null?'—':`${value.toLocaleString(locale,{maximumFractionDigits:3})}${unit?` ${unit}`:''}`;
  return (<>
    <p className="hint">{t('compare.profile.boundary',locale)}</p>
    {omitted.length > 0 && <p role="status">{t('scan.timing.notComparable', locale)}: {omitted.map(axis => `${axis.label} (${t(`scan.timing.reason.${axis.reason!}`, locale)})`).join('; ')}</p>}
    {available.length>=3?<RadarChartBase
      data={available.map((axis) => ({ axis: axis.label, values: [axis.l, axis.r] }))}
      colors={['var(--accent-fg)', 'var(--attention-fg)']}
      fills={['var(--accent-subtle)', 'var(--attention-subtle)']}
      size={220}
      ariaLabel={t('compare.profile.title', locale)}
    />:<p>{t('compare.profile.tooFew',locale)}</p>}
    <details className="compare-profile-values" open={available.length<3}><summary>{t('compare.profile.values',locale)} · L / R</summary>
      <table className="ui-table ui-table-compact"><thead><tr><th scope="col">{t('compare.profile.metric',locale)}</th><th scope="col">L</th><th scope="col">R</th><th scope="col">{t('compare.profile.scale',locale)}</th></tr></thead>
        <tbody>{axes.map(axis=><tr key={axis.label}><th scope="row">{axis.label}</th><td className="mono">{fmt(axis.lv,axis.unit)}</td><td className="mono">{fmt(axis.rv,axis.unit)}</td><td className="mono">{axis.reason===null?fmt(axis.max,axis.unit):'—'}</td></tr>)}</tbody>
      </table>
    </details>
  </>);
}

/** Reuse the same native-total accounting as the speed-panel bars. */
export function TokenDonutChart({
  result,
  locale,
  onSegmentClick,
}: {
  result: CompareResult;
  locale: Locale;
  onSegmentClick?: (side: 'left' | 'right', tokenClass: TokenClass) => void;
}): React.JSX.Element {
  return <CompareTokenUsage usage={{left:result.left.session.tokenUsage,right:result.right.session.tokenUsage}}
    estimates={{left:result.speed.left.systemPromptTokensEstimate,right:result.speed.right.systemPromptTokensEstimate}}
    pending={{left:result.left.pending,right:result.right.pending}} locale={locale} onInspectText={onSegmentClick}/>;
}

/** 建议 1-③：6 阶段双向耗时条形图（SVG 发散条，左 accent / 右 attention）。 */
export function PhaseBarChart({
  result,
}: {
  result: CompareResult;
}): React.JSX.Element {
  const left = phaseDurations(result.left.events as TraceEventSlim[]);
  const right = phaseDurations(result.right.events as TraceEventSlim[]);
  const max = Math.max(
    1,
    ...TRACE_PHASES.map((phase) => Math.max(left[phase], right[phase])),
  );
  const rowHeight = 26;
  const axisX = 170;
  const barMax = 130;
  const height = TRACE_PHASES.length * rowHeight + 8;

  return (
    <svg viewBox={`0 0 440 ${height}`} width="100%" height={height} role="img" aria-label={ta('a11y.phaseDurationChart')}>
      <line x1={axisX} y1={4} x2={axisX} y2={height - 4} stroke="var(--border-default)" strokeWidth={1} />
      {TRACE_PHASES.map((phase, i) => {
        const y = 8 + i * rowHeight;
        const lw = (left[phase] / max) * barMax;
        const rw = (right[phase] / max) * barMax;
        return (
          <g key={phase}>
            <circle cx={8} cy={y + 5} r={3} fill={`var(--phase-${phase})`} />
            <text x={16} y={y + 8} fill="var(--fg-muted)" fontSize={9}>
              {phase}
            </text>
            <text x={axisX - 5} y={y + 8} textAnchor="end" fill="var(--accent-fg)" fontSize={8} className="mono">
              {(left[phase] / 1000).toFixed(1)}s
            </text>
            <rect x={axisX - lw} y={y} width={lw} height={7} rx={2} fill="var(--accent-emphasis)" />
            <rect x={axisX} y={y} width={rw} height={7} rx={2} fill="var(--attention-emphasis)" />
            <text x={axisX + rw + 5} y={y + 8} fill="var(--attention-fg)" fontSize={8} className="mono">
              {(right[phase] / 1000).toFixed(1)}s
            </text>
          </g>
        );
      })}
      <text x={axisX - 5} y={height - 2} textAnchor="end" fill="var(--accent-fg)" fontSize={8}>
        L
      </text>
      <text x={axisX + 5} y={height - 2} fill="var(--attention-fg)" fontSize={8}>
        R
      </text>
    </svg>
  );
}

/** 建议 1-④：事件类型分布（10+ 种 kind 横向条形，左 accent / 右 attention）。 */
export function EventKindChart({
  result,
}: {
  result: CompareResult;
}): React.JSX.Element {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const lKinds = eventKindCounts(leftEvents);
  const rKinds = eventKindCounts(rightEvents);
  const kindMax = Math.max(1, ...TRACE_KINDS.map((k) => Math.max(lKinds.get(k) ?? 0, rKinds.get(k) ?? 0)));
  return (
    <div className="compare-dist">
      {TRACE_KINDS.map((kind) => {
        const lc = lKinds.get(kind) ?? 0;
        const rc = rKinds.get(kind) ?? 0;
        if (lc === 0 && rc === 0) {
          return null;
        }
        return (
          <div key={kind} className="compare-dist-row">
            <span className="mono compare-dist-label">{kind}</span>
            <div className="compare-dist-bars">
              <div className="ui-bar-meter">
                <div className="ui-bar-meter-fill" style={{ width: `${(lc / kindMax) * 100}%`, background: 'var(--accent-emphasis)' }} />
              </div>
              <div className="ui-bar-meter">
                <div className="ui-bar-meter-fill" style={{ width: `${(rc / kindMax) * 100}%`, background: 'var(--attention-emphasis)' }} />
              </div>
            </div>
            <span className="mono compare-dist-count">{lc} / {rc}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 建议 1：Compare 图表 section（雷达 + 双环 + 阶段条 + 事件分布）。 */
export function CompareCharts({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const [openToken, setOpenToken] = useState<{ side: 'left' | 'right'; tokenClass: TokenClass } | null>(null);
  const side = openToken === null ? null : result[openToken.side];
  return (
    <>
      <div className="compare-charts">
        <div className="compare-chart">
          <h4>{t('compare.profile.title', locale)}</h4>
          <RadarChart result={result} locale={locale} />
          <p className="compare-chart-criteria">{t('compare.charts.criteria.radar', locale)}</p>
        </div>
        <div className="compare-chart">
          <h4>{t('compare.charts.tokenDonut', locale)}</h4>
          <TokenDonutChart
            result={result}
            locale={locale}
            onSegmentClick={(s, tokenClass) => setOpenToken({ side: s, tokenClass })}
          />
          <p className="compare-chart-criteria">{t('compare.charts.criteria.tokenDonut', locale)}</p>
        </div>
        <div className="compare-chart">
          <h4>{t('compare.charts.phaseBar', locale)}</h4>
          <PhaseBarChart result={result} />
          <p className="compare-chart-criteria">{t('compare.charts.criteria.phaseBar', locale)}</p>
        </div>
        <div className="compare-chart">
          <h4>{t('compare.distribution', locale)}</h4>
          <EventKindChart result={result} />
          <p className="compare-chart-criteria">{t('compare.charts.criteria.distribution', locale)}</p>
        </div>
      </div>
      {side !== null && openToken !== null && (
        <TokenTextModal
          sessionKey={side.session.id}
          provider={side.session.provider}
          agentName={side.session.sourceAgent}
          tokenClass={openToken.tokenClass}
          tokenCount={(() => {
            const cls = openToken.tokenClass;
            if (cls === 'system') {
              return result.speed[openToken.side].systemPromptTokensEstimate ?? 0;
            }
            return side.session.tokenUsage[cls];
          })()}
          locale={locale}
          onClose={() => setOpenToken(null)}
        />
      )}
    </>
  );
}
