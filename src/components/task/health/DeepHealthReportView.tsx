import type { Locale } from '../../../i18n.js';
import type { DeepHealthReport } from '../../../core/task-health/types.js';
import { healthApi } from './health-client.js';
import { healthCopy } from './health-copy.js';
export function DeepHealthReportView({ report: r, locale }: { report: DeepHealthReport; locale: Locale }) {
  const c = healthCopy(locale);
  const rows = (items: object[]) => <ul>{items.map((item, index) => <li key={index}>{Object.entries(item).map(([key, value]) => <p key={key}><strong>{key}: </strong>{Array.isArray(value) ? value.join(', ') : String(value)}</p>)}</li>)}</ul>;
  return <article className="health-report" aria-label={c.deepTab}>
    <h2>{c.deepTab} · {r.status} · model_judged</h2>
    <nav aria-label={c.export}>{(['html', 'md', 'json'] as const).map(format => <a key={format} href={healthApi.exportUrl(r.id, format)} download>{format}</a>)}</nav>
    <section><h3>{c.causes}</h3>{rows(r.causes)}</section>
    <section><h3>{c.valueMoments}</h3>{rows(r.valueMoments)}</section>
    <section><h3>{c.necessity}</h3>{rows(r.necessity)}</section>
    <section><h3>{c.experiments}</h3>{rows(r.experiments)}</section>
    <section><h3>{c.rejected}</h3>{rows(r.rejected)}</section>
    <section><h3>{c.analysis}</h3><p>{r.provider} / {r.model} · prompt v{r.promptVersion}</p><p>digest: {r.digest}</p><p>inputTokens: {r.analysis.inputTokens ?? '—'} · outputTokens: {r.analysis.outputTokens ?? '—'} · {r.analysis.durationMs.toFixed(0)}ms</p><p>{r.limitations.join(' · ')}</p></section>
  </article>;
}
