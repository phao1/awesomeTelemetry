import { Card, CardHeader, CardBody, Accordion, Callout, KeyValue } from '../../ui/Display.js';
import { Badge } from '../../ui/Badge.js';
import type { Locale } from '../../../i18n.js';
import type { DeepHealthReport, HealthReport } from '../../../core/task-health/types.js';
import { deepAnalysisText, deepFields, deepLabel, deepLimitation, healthLabel } from '../../../core/task-health/format.js';
import { HealthReportExport } from './HealthReportExport.js';
import { healthCopy } from './health-copy.js';
export function DeepHealthReportView({ report: r, locale, parent }: { report: DeepHealthReport; locale: Locale; parent?: HealthReport }) {
  const c = healthCopy(locale);
  const rows = (items: object[]) => <ul>{items.map((item, index) => <li key={index}><Card><CardBody><KeyValue items={deepFields(item,locale,parent).map(field=>({label:field.label+': ',value:<span title={field.title}>{field.text}</span>}))}/></CardBody></Card></li>)}</ul>;
  return <article className="health-report" aria-label={c.deepTab}>
    <CardHeader title={c.deepTab} actions={<><Badge>{deepLabel(r.status,locale)}</Badge><Badge>{healthLabel(r.timing,locale)}</Badge></>}/>
    <div className="health-toolbar"><HealthReportExport id={r.id} locale={locale}/></div>
    <Callout title={c.conclusion} tone={r.status==='rejected'?'danger':r.status==='partial'?'attention':'neutral'}><ul>{r.causes.map((cause,i)=><li key={i}>{deepFields(cause,locale,parent).filter(field=>field.label===deepLabel('hypothesis',locale)).map(field=>field.text).join(' · ')}</li>)}{!r.causes.length&&<li>{deepLabel(r.status,locale)} · {healthLabel(r.timing,locale)}</li>}</ul></Callout>
    <section><h3>{c.causes}</h3>{rows(r.causes)}</section>
    <section><h3>{c.valueMoments}</h3>{rows(r.valueMoments)}</section>
    <section><h3>{c.necessity}</h3>{rows(r.necessity)}</section>
    <section><h3>{c.experiments}</h3>{rows(r.experiments)}</section>
    {r.rejected.length > 0 && <section><h3>{c.rejected}</h3>{rows(r.rejected)}</section>}
    <Accordion title={c.analysis}><section><h3>{c.analysis}</h3><p>{r.provider} / {r.model} · {locale === 'zh' ? '提示词版本' : 'Prompt version'} {r.promptVersion}</p><p>digest: {r.digest}</p><p>{deepAnalysisText(r.analysis, locale)}</p>{r.limitations.map((code, i) => { const limitation = deepLimitation(code, locale); return limitation.detail ? <Accordion key={i} title={limitation.text}><p>{limitation.detail}</p></Accordion> : <p key={i}>{limitation.text}</p>; })}</section></Accordion>
  </article>;
}
