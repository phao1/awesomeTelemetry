import { Card, CardHeader, CardBody, Accordion, Callout, Meter, KeyValue } from '../../ui/Display.js';
import { Badge } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { DataTable } from '../../ui/DataTable.js';
import type { Locale } from '../../../i18n.js';
import type { HealthEvidence, HealthFinding, HealthMetric, HealthReport } from '../../../core/task-health/types.js';
import { deepFields, deepLimitation, coverageReason, formatDuration, formatFact, healthLabel, metricValue, metricFacets, metricName, reconciliationRows, basisMetrics, dimensionMetrics, compactMetricRows, emptyLayersText, dominantAgentPartition } from '../../../core/task-health/format.js';
import { unionDuration } from '../../../core/task-health/intervals.js';
import { HealthReportExport } from './HealthReportExport.js';
import { HealthSeveritySummary } from './HealthSeveritySummary.js';
import { healthCopy, healthProse, healthSeverity } from './health-copy.js';
const dimensions = ['perceived', 'plan', 'act', 'model', 'startup'] as const;
export function HealthReportView({ report: r, locale, onLocate }: { report: HealthReport; locale: Locale; onLocate: (evidence: HealthEvidence, recordId: string) => void }) {
  const c = healthCopy(locale);
  const ranked = [...r.findings].sort((a, b) => unionDuration(b.intervalMs ?? []) - unionDuration(a.intervalMs ?? []) || a.id.localeCompare(b.id));
  const partial = r.coverage.members.loaded < r.coverage.members.total || r.coverage.reasons.length > 0 || r.coverage.limits.length > 0;
  const evidence = (f: HealthFinding) => <ul>{f.evidenceIds.map(id => { const e = r.evidence.find(item => item.id === id); return <li key={id}>{e ? <>{e.title}{e.recordIds.length ? e.recordIds.map(recordId => <Button variant="ghost" type="button" key={recordId} onClick={() => onLocate(e, recordId)}>{c.evidence} · {recordId}</Button>) : <span>{c.inaccessible}</span>}</> : c.inaccessible}</li>; })}</ul>;
  const finding = (f: HealthFinding) => <Card key={f.id} className="health-finding"><CardHeader title={<><Badge tone={f.severity==='warning'?'danger':f.severity==='notice'?'attention':'neutral'}>{healthSeverity(f.severity,locale)}</Badge> {deepFields({findingId:f.id},locale,r)[0]?.text}</>} description={healthProse(f.recommendation.action,locale)}/><CardBody>{evidence(f)}<p>{c.conditions}: {healthProse(f.recommendation.conditions, locale)}</p><Accordion title={c.facts}><KeyValue items={Object.entries(f.facts).map(([key,value])=>({label:key,value:formatFact(key,value,locale)}))}/><p>{c.retest}: {f.recommendation.retest.map(key=>`${metricName(key,locale)} (${key})`).join(' / ')}</p></Accordion></CardBody></Card>;
  const metricTable = (metrics:HealthMetric[]) => <DataTable locale={locale} rows={metrics.map((metric,index)=>({metric,index}))} rowKey={row=>String(row.index)} columns={[
    {key:'metric',label:c.item,render:({metric:m})=><span><strong>{metricName(m.key,locale)}</strong> <small className="health-metric-key">({m.key})</small>{(m.key.startsWith('ux.')||m.layer==='log_upper_bound')&&<Badge className="health-log-label">{c.log}</Badge>}</span>},
    {key:'value',label:c.value,render:({metric:m})=><span title={m.reason?coverageReason(m.reason,locale):undefined}>{metricValue(m,locale)}</span>},
    {key:'basis',label:c.timing,render:({metric:m})=>`${metricFacets(m,locale,r.t0)} · ${healthLabel(m.stat,locale)} · ${healthLabel(m.timing,locale)}${m.layer?' / '+healthLabel(m.layer,locale):''} · ${c.samples} ${m.samples}`}
  ]}/>;
  const metricList = (metrics: HealthMetric[]) => {
    const compact = compactMetricRows(metrics);
    const missing = compact.rows.filter(m => m.value === null);
    const count = metrics.filter(m => m.value === null).length;
    return <>{metricTable(compact.rows.filter(m => m.value !== null))}{count > 0 && <Accordion title={`${c.missingMetrics}（${count}）`}>{metricTable(missing)}{compact.emptyLayers.map(group => <p key={group.key}>{emptyLayersText(group, locale)}</p>)}</Accordion>}</>;
  };
  const dominant = dominantAgentPartition(r);
  return <article className="health-report">
    <div className="health-toolbar"><HealthReportExport id={r.id} locale={locale}/></div>
    <section><HealthSeveritySummary findings={r.findings} locale={locale}/><Meter label={c.coverage} value={r.coverage.members.loaded} max={r.coverage.members.total}/>
      <Callout title={c.conclusion} tone={partial?'attention':ranked.some(f=>f.severity==='warning')?'danger':ranked.length?'attention':'neutral'}><ul><li>{r.coverage.members.loaded}/{r.coverage.members.total} {c.coverage}</li>{partial&&<li>{c.insufficient}</li>}{ranked.slice(0,5).map(f=><li key={f.id}>{healthProse(f.recommendation.action,locale)}</li>)}{!ranked.length&&<li>{c.noFindings}</li>}<li>{healthLabel(r.dimensions.quality,locale)} · {c.qualityHint}</li></ul></Callout>
      <div className="health-issues">{ranked.map(finding)}</div>
    </section>
    <section><h3>{c.equation}</h3><Card><DataTable rows={reconciliationRows(r,locale).map((cells,id)=>({cells,id}))} rowKey={row=>String(row.id)} locale={locale} columns={[c.item,c.value,c.timing].map((label,i)=>({key:String(i),label,render:(row:{cells:string[];id:number})=>row.cells[i]??'—'}))}/></Card>{dominant && <p>{`${c.amdahl}: ${healthLabel(dominant[0], locale)} · ${formatDuration(dominant[1], locale)}`}</p>}{!r.partition && <p>{c.noPartition}</p>}</section>
    <section><h3>{c.dimensions}</h3>{dimensions.map(d => <section className="health-card" key={d}><h4>{healthLabel(d, locale)} · {healthLabel(r.dimensions[d], locale)}</h4>{d === 'perceived' ? <p>{c.experienceReference}</p> : metricList(dimensionMetrics(r, d))}</section>)}</section>
    <Accordion title={locale==='zh'?'报告详情':'Report details'}><section><h3>{c.snapshot}</h3>{r.scope.request&&<p>{locale==='zh'?'请求':'Request'} · {r.scope.request}</p>}<p>{r.taskId} · {r.scope.member === 'all' ? c.all : r.scope.member === 'main' ? c.main : r.scope.member}</p><p>{r.scope.from ?? c.start} → {r.scope.to ?? c.end}</p><p>{r.running ? c.running : c.historical} · {r.snapshotAt}</p><p>revision: {r.revision}</p><p>{Object.entries(r.coverage.timing).map(([key, value]) => `${healthLabel(key, locale)} ${value}`).join(' / ')}</p>{[...r.coverage.reasons, ...r.coverage.limits].map((reason, i) => <p key={i}>{coverageReason(reason, locale)}</p>)}</section>
    <section><h3>{c.experience}</h3><p>{c.logHint}</p>{metricList(r.metrics.filter(m => m.key.startsWith('ux.')))}</section>
    <section><h3>{c.quality}</h3><p>{healthLabel(r.dimensions.quality, locale)} · {c.qualityHint}</p></section>
    <section><h3>{c.recommendations}</h3>{dimensions.map(d => <div key={d}><h4>{healthLabel(d, locale)}</h4>{ranked.filter(f => f.dimension === d).map(f => <p key={f.id}>{healthProse(f.recommendation.action, locale)} · {c.conditions}: {healthProse(f.recommendation.conditions, locale)} · {c.retest}: {f.recommendation.retest.join(' / ')}</p>)}</div>)}</section>
    <section><h3>{c.basis}</h3><p>calcVersion: {r.calcVersion} · ruleVersion: {r.ruleVersion}</p><Accordion title={`${c.thresholds} · ${r.thresholds.profile}`}><KeyValue items={Object.entries(r.thresholds).map(([key,value])=>({label:key,value:key.endsWith('Ms')?formatDuration(value as number|null,locale):value??'—'}))}/></Accordion><p>{c.metricsReference}</p>{metricList(basisMetrics(r))}{r.limitations.map((line, i) => <p key={i}>{line === 'partial_public_projection' || line.startsWith('Partial public projection:') ? deepLimitation(line, locale).text : line.includes(' / ') ? healthProse(line, locale) : coverageReason(line, locale)}</p>)}</section></Accordion><footer>{c.footer}</footer>
  </article>;
}
