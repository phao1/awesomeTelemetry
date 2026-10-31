import type {SessionDetailResponse,TraceEventSlim} from '../core/trace-types.js';
import {t,type Locale} from '../i18n.js';
import type {CompareResult} from './compare-types.js';

export interface CompareRunEvidenceProps {
  result:CompareResult;
  locale:Locale;
  onOpenRun?:(key:string,eventId?:string)=>void;
  onOpenCalls?:()=>void;
}

/** Loaded metadata only: no body reads, inferred task alignment or execution edges. */
export function CompareRunEvidence({result,locale,onOpenRun,onOpenCalls}:CompareRunEvidenceProps):React.JSX.Element {
  const side=(name:'L'|'R',detail:SessionDetailResponse):React.JSX.Element=>{
    const {session}=detail;
    const events=detail.events as TraceEventSlim[];
    const errors=events.filter(event=>event.status==='error'||event.error!==null);
    const longest=events.reduce<TraceEventSlim|null>((current,event)=>Number.isFinite(event.durationMs)&&event.durationMs>0&&(current===null||event.durationMs>current.durationMs)?event:current,null);
    const partial=detail.pending||detail.hasMore||detail.eventOffset!==0||events.length<detail.eventTotal;
    const open=(event:TraceEventSlim):React.JSX.Element=><button type="button" className="btn cmp-evidence-event"
      onClick={()=>onOpenRun?.(session.id,event.id)} disabled={!onOpenRun} title={event.id}>
      <span className="mono">#{event.sequence}</span><span>{event.tool??event.title??event.id}</span>
    </button>;
    return <article className="cmp-evidence-side" key={name} aria-label={`${name} ${t('compare.evidence.scope',locale)}`}>
      <header><span className="compare-side-mark">{name}</span><h4 title={session.id}>{session.title||session.id}</h4>
        <button type="button" className="btn ui-btn-sm" disabled={!onOpenRun} onClick={()=>onOpenRun?.(session.id)}>{t('compare.evidence.openRun',locale)}</button></header>
      <p>{session.dataSource} / {session.provider} / {session.sourceAgent} · {session.primaryModel??'—'}</p>
      <p>{t('session.metric.loaded',locale).replace('{loaded}',String(events.length)).replace('{total}',String(detail.eventTotal))}{' · '}
        <span>{t(partial?'compare.evidence.partial':'compare.evidence.complete',locale)}</span></p>
      <details><summary>{t('compare.evidence.locators',locale).replace('{n}',String(errors.length))}</summary>
      <p className="mono">{session.id}</p>
      <p>{t('compare.evidence.durationSource',locale)}: {session.durationSource??'unknown'}</p>
      <div className="cmp-evidence-errors"><strong>{t('compare.evidence.errors',locale)} · {errors.length}</strong>
        {errors.length===0?<p>{t('compare.evidence.noErrors',locale)}</p>:<div>{errors.slice(0,3).map(event=><span key={event.id}>{open(event)}</span>)}</div>}
        {errors.length>3&&<p>{t('compare.evidence.moreErrors',locale).replace('{n}',String(errors.length-3))}</p>}
      </div>
      {longest!==null&&<div className="cmp-evidence-longest"><strong>{t('investigation.longest',locale)} · {(longest.durationMs/1000).toFixed(1)}s</strong>{open(longest)}</div>}
      </details>
    </article>;
  };
  return <section className="cmp-run-evidence" aria-label={t('compare.evidence.title',locale)}>
    <header><h3>{t('compare.evidence.title',locale)}</h3>{onOpenCalls&&<button type="button" className="btn ui-btn-sm" onClick={onOpenCalls}>{t('compare.evidence.calls',locale)}</button>}</header>
    <p>{t('compare.evidence.boundary',locale)}</p>
    <div className="cmp-evidence-grid">{side('L',result.left)}{side('R',result.right)}</div>
    <p className="hint">{t('compare.evidence.interval',locale)}</p>
  </section>;
}
