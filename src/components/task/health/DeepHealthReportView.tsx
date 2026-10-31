import type { Locale } from '../../../i18n.js';
import type { DeepHealthReport, HealthReport } from '../../../core/task-health/types.js';
import { deepAnalysisText, deepFields, deepLabel, deepLimitation, healthLabel } from '../../../core/task-health/format.js';
import { healthApi } from './health-client.js';
import { healthCopy } from './health-copy.js';
export function DeepHealthReportView({ report: r, locale, parent }: { report: DeepHealthReport; locale: Locale; parent?: HealthReport }) {
  const c = healthCopy(locale);
  const rows = (items: object[]) => <ul>{items.map((item, index) => <li key={index}>{deepFields(item, locale, parent).map((field, i) => <p key={i}><strong>{field.label}: </strong><span title={field.title}>{field.text}</span></p>)}</li>)}</ul>;
  return <article className="health-report" aria-label={c.deepTab}>
    <h2>{c.deepTab} · {deepLabel(r.status, locale)} · {healthLabel(r.timing, locale)}</h2>
    <nav aria-label={c.export}>{(['html', 'md', 'json'] as const).map((format, i) => <span key={format}>{i > 0 && ' · '}<a href={healthApi.exportUrl(r.id, format)} download>{format === 'md' ? 'Markdown' : format.toUpperCase()}</a></span>)}</nav>
    <section><h3>{c.causes}</h3>{rows(r.causes)}</section>
    <section><h3>{c.valueMoments}</h3>{rows(r.valueMoments)}</section>
    <section><h3>{c.necessity}</h3>{rows(r.necessity)}</section>
    <section><h3>{c.experiments}</h3>{rows(r.experiments)}</section>
    <section><h3>{c.rejected}</h3>{rows(r.rejected)}</section>
    <section><h3>{c.analysis}</h3><p>{r.provider} / {r.model} · {locale === 'zh' ? '提示词版本' : 'Prompt version'} {r.promptVersion}</p><p>digest: {r.digest}</p><p>{deepAnalysisText(r.analysis, locale)}</p>{r.limitations.map((code, i) => { const limitation = deepLimitation(code, locale); return limitation.detail ? <details key={i}><summary>{limitation.text}</summary><p>{limitation.detail}</p></details> : <p key={i}>{limitation.text}</p>; })}</section>
  </article>;
}
