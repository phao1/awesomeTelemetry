import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Locale } from '../../../i18n.js';
import type { HealthEvidence, HealthFinding, HealthMetric, HealthReport } from '../../../core/task-health/types.js';
import { coverageReason, formatDuration, formatFact, healthLabel, metricValue, metricFacets, metricName, reconciliationRows, basisMetrics, dimensionMetrics, compactMetricRows, emptyLayersText, dominantAgentPartition } from '../../../core/task-health/format.js';
import { unionDuration } from '../../../core/task-health/intervals.js';
import { healthApi } from './health-client.js';
import { healthCopy, healthProse } from './health-copy.js';
const dimensions = ['perceived', 'plan', 'act', 'model', 'startup'] as const;
export function HealthReportView({ report: r, locale, onLocate }: { report: HealthReport; locale: Locale; onLocate: (evidence: HealthEvidence, recordId: string) => void }) {
  const c = healthCopy(locale), [font, setFont] = useState(13);
  const ranked = [...r.findings].sort((a, b) => unionDuration(b.intervalMs ?? []) - unionDuration(a.intervalMs ?? []) || a.id.localeCompare(b.id));
  const partial = r.coverage.members.loaded < r.coverage.members.total || r.coverage.reasons.length > 0 || r.coverage.limits.length > 0;
  const evidence = (f: HealthFinding) => <ul>{f.evidenceIds.map(id => { const e = r.evidence.find(item => item.id === id); return <li key={id}>{e ? <>{e.title}{e.recordIds.length ? e.recordIds.map(recordId => <button className="btn" type="button" key={recordId} onClick={() => onLocate(e, recordId)}>{c.evidence} · {recordId}</button>) : <span>{c.inaccessible}</span>}</> : c.inaccessible}</li>; })}</ul>;
  const finding = (f: HealthFinding) => <details key={f.id}><summary>{healthProse(f.recommendation.action, locale)}</summary><dl>{Object.entries(f.facts).map(([key, value]) => <div key={key}><dt>{c.facts} · {key}</dt><dd>{formatFact(key, value, locale)}</dd></div>)}</dl>{evidence(f)}<p>{c.conditions}: {healthProse(f.recommendation.conditions, locale)}</p><p>{c.retest}: {f.recommendation.retest.map(key => `${metricName(key, locale)} (${key})`).join(' / ')}</p></details>;
  const metricRow = (m: HealthMetric, i: number) => <p key={i}><strong>{metricName(m.key, locale)}</strong> <small className="health-metric-key">({m.key})</small> · {metricFacets(m, locale, r.t0)} · {healthLabel(m.stat, locale)}: <span title={m.reason ? coverageReason(m.reason, locale) : undefined}>{metricValue(m, locale)}</span> · {healthLabel(m.timing, locale)}{m.layer ? ` / ${healthLabel(m.layer, locale)}` : ''} · {c.samples} {m.samples}{(m.key.startsWith('ux.') || m.layer === 'log_upper_bound') && <span className="health-log-label" title={c.logHint}>{c.log}</span>}</p>;
  const metricList = (metrics: HealthMetric[]) => {
    const compact = compactMetricRows(metrics);
    const missing = compact.rows.filter(m => m.value === null);
    const count = metrics.filter(m => m.value === null).length;
    return <>{compact.rows.filter(m => m.value !== null).map(metricRow)}{count > 0 && <details className="health-missing-metrics"><summary>{c.missingMetrics}（{count}）</summary>{missing.map(metricRow)}{compact.emptyLayers.map(group => <p key={group.key}>{emptyLayersText(group, locale)}</p>)}</details>}</>;
  };
  const dominant = dominantAgentPartition(r);
  return <article className="health-report" style={{ '--user-font-size': `${font}px` } as CSSProperties}>
    <div className="health-toolbar"><button type="button" aria-label={c.fontSmaller} disabled={font <= 8} onClick={() => setFont(n => Math.max(8, n - 1))}>A−</button><button type="button" aria-label={c.fontLarger} disabled={font >= 28} onClick={() => setFont(n => Math.min(28, n + 1))}>A+</button><button type="button" onClick={() => setFont(13)}>{c.fontReset}</button>{(['html', 'md', 'json'] as const).map(format => <a className="btn" key={format} href={healthApi.exportUrl(r.id, format)} download>{c.export} {format === 'md' ? 'Markdown' : format.toUpperCase()}</a>)}</div>
    <section><h3>{c.conclusion}</h3><p>{r.coverage.members.loaded}/{r.coverage.members.total} {c.coverage}</p>{partial && <p role="status">{c.insufficient}</p>}<ul>{ranked.slice(0, 5).map(f => <li key={f.id}>{healthProse(f.recommendation.action, locale)}</li>)}</ul>{!ranked.length && <p>{c.noFindings}</p>}<p>{healthLabel(r.dimensions.quality, locale)} · {c.qualityHint}</p></section>
    <section><h3>{c.equation}</h3><table><thead><tr><th>{c.item}</th><th>{c.value}</th><th>{c.timing}</th></tr></thead><tbody>{reconciliationRows(r, locale).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table>{dominant && <p>{`${c.amdahl}: ${healthLabel(dominant[0], locale)} · ${formatDuration(dominant[1], locale)}`}</p>}{!r.partition && <p>{c.noPartition}</p>}</section>
    <section><h3>{c.dimensions}</h3>{dimensions.map(d => <section className="health-card" key={d}><h4>{healthLabel(d, locale)} · {healthLabel(r.dimensions[d], locale)}</h4>{ranked.filter(f => f.dimension === d).map(finding)}{d === 'perceived' ? <p>{c.experienceReference}</p> : metricList(dimensionMetrics(r, d))}</section>)}</section>
    <section><h3>{c.snapshot}</h3><p>{r.taskId} · {r.scope.member === 'all' ? c.all : r.scope.member === 'main' ? c.main : r.scope.member}</p><p>{r.scope.from ?? c.start} → {r.scope.to ?? c.end}</p><p>{r.running ? c.running : c.historical} · {r.snapshotAt}</p><p>revision: {r.revision}</p><p>{Object.entries(r.coverage.timing).map(([key, value]) => `${healthLabel(key, locale)} ${value}`).join(' / ')}</p>{[...r.coverage.reasons, ...r.coverage.limits].map((reason, i) => <p key={i}>{coverageReason(reason, locale)}</p>)}</section>
    <section><h3>{c.experience}</h3><p>{c.logHint}</p>{metricList(r.metrics.filter(m => m.key.startsWith('ux.')))}</section>
    <section><h3>{c.quality}</h3><p>{healthLabel(r.dimensions.quality, locale)} · {c.qualityHint}</p>{ranked.filter(f => f.dimension === 'quality').map(finding)}</section>
    <section><h3>{c.recommendations}</h3>{dimensions.map(d => <div key={d}><h4>{healthLabel(d, locale)}</h4>{ranked.filter(f => f.dimension === d).map(f => <p key={f.id}>{healthProse(f.recommendation.action, locale)} · {c.conditions}: {healthProse(f.recommendation.conditions, locale)} · {c.retest}: {f.recommendation.retest.join(' / ')}</p>)}</div>)}</section>
    <section><h3>{c.basis}</h3><p>calcVersion: {r.calcVersion} · ruleVersion: {r.ruleVersion}</p><details><summary>{c.thresholds} · {r.thresholds.profile}</summary><dl>{Object.entries(r.thresholds).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{key.endsWith('Ms') ? formatDuration(value as number | null, locale) : value ?? '—'}</dd></div>)}</dl></details><p>{c.metricsReference}</p>{metricList(basisMetrics(r))}{r.limitations.map((line, i) => <p key={i}>{line.includes(' / ') ? healthProse(line, locale) : coverageReason(line, locale)}</p>)}</section><footer>{c.footer}</footer>
  </article>;
}
