import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { TaskContext, TaskRecord } from '../../core/task-types.js';
import type { TraceEvent, TraceEventRaw, TraceLogTurnDetail } from '../../core/trace-types.js';
import type { Locale } from '../../i18n.js';
import { SessionCaptureLinksPanel } from '../TraceLinksPanel.js';
import { pushOverlay } from '../../keyboard.js';
import { copy } from './copy.js';
import { useTaskRead } from './task-data.js';

type Tab = 'summary' | 'input' | 'output' | 'timing' | 'rawBody' | 'source';
export function TaskEvidence({ context, record, relatedRecords = [], onSelectRelated, locale, initialRaw, onClose, onLocate, onOpenRequest, onOpenSession }: {
  context: TaskContext; record: TaskRecord; locale: Locale; initialRaw: boolean; onClose: () => void;
  relatedRecords?: TaskRecord[]; onSelectRelated?: (record: TaskRecord) => void;
  onLocate: () => void; onOpenRequest: (id: number) => void; onOpenSession: (key: string) => void;
}): React.JSX.Element {
  const c = copy(locale), [tab, setTab] = useState<Tab>(initialRaw ? 'rawBody' : 'summary'), [expanded, setExpanded] = useState(false);
  const cache = useRef(new Map<string, TraceEvent | TraceEventRaw | TraceLogTurnDetail>());
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => pushOverlay(onClose), [onClose]);
  useEffect(() => { const prior = document.activeElement; closeButton.current?.focus(); return () => { if (prior instanceof HTMLElement && prior.isConnected) prior.focus(); }; }, []);
  const raw = tab === 'rawBody', needsBody = tab === 'input' || tab === 'output' || raw;
  const evidenceRecord = tab === 'input' && !record.event?.hasInput ? relatedRecords.find(item => item.event?.hasInput) ?? record
    : tab === 'output' && !record.event?.hasOutput ? [...relatedRecords].reverse().find(item => item.event?.hasOutput) ?? record : record;
  const read = useCallback(async (signal: AbortSignal) => {
    const key = evidenceRecord.id + (raw ? ':raw' : ':body'), existing = cache.current.get(key);
    if (existing) return existing;
    const result = evidenceRecord.event && evidenceRecord.sessionKey
      ? await api.eventDetail(evidenceRecord.sessionKey, evidenceRecord.event.id, raw, signal)
      : await api.traceLogTurn(context.importSession!.id, evidenceRecord.importedTurn!.sequence, signal);
    if (!signal.aborted) cache.current.set(key, result);
    return result;
  }, [evidenceRecord, raw, context.importSession]);
  const body = useTaskRead(needsBody ? evidenceRecord.id + (raw ? ':raw' : ':body') : null, read, 10000);
  const event = record.event, turn = record.importedTurn;
  let content: unknown = null;
  if (body.value) {
    if ('raw' in body.value && 'sessionId' in body.value && 'session' in body.value) {
      const value = (body.value as TraceLogTurnDetail).raw;
      content = raw ? value : tab === 'input' ? value.messages ?? value.system_prompt : value.output_text;
    } else {
      const value = body.value as TraceEventRaw;
      content = raw ? value.raw : tab === 'input' ? value.inputSummary : value.outputSummary;
    }
  }
  const text = content === null || content === undefined || content === '' ? c.missing : typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  let previewEnd = 0, previewBytes = 0;
  for (const character of text) { const point = character.codePointAt(0)!; const bytes = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; if (previewBytes + bytes > 65536) break; previewBytes += bytes; previewEnd += character.length; }
  const title = event?.title || `${c.sequence} ${event?.sequence ?? turn?.sequence ?? ''}`;
  const item = (label: string, value: string | number | null | undefined) => <div><dt>{label}</dt><dd>{value ?? '—'}</dd></div>;
  return <aside className="task-evidence" aria-label={c.inspect}>
    <header><div><span className="task-eyebrow">{c.inspect}</span><h3 title={title}>{title}</h3></div><button ref={closeButton} type="button" className="ui-icon-btn" aria-label={c.close} onClick={onClose}>×</button></header>
    <div className="task-evidence-tabs" role="tablist" aria-label={c.inspect}>{(['summary', 'input', 'output', 'timing', 'rawBody', 'source'] as const).map(value => <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => { setTab(value); setExpanded(false); }}>{c[value]}</button>)}</div>
    <div className="task-evidence-content" role="tabpanel">
      {tab === 'summary' && <><span className="task-badge">{c[context.task.origin]}</span><h4>{title}</h4>{event?.error && <p className="task-evidence-error" role="alert">{event.error}</p>}<dl>{item(c.member, record.memberName)}{item(c.type, event?.kind ?? 'TraceLog')}{item(c.sequence, event?.sequence ?? turn?.sequence)}{item(c.recordState, event?.status ?? (turn?.isError === null ? c.statusUnknown : turn?.isError ? c.statusError : c.statusSuccess))}{item(c.start, event?.startedAt ?? turn?.requestTime)}{item(c.identity, record.id)}</dl><p className="hint">{context.task.origin === 'imported' ? c.importedBoundary : c.rawBoundary}</p><button type="button" className="btn ui-btn-primary" onClick={() => setTab('output')}>{c.output} ↗</button></>}
      {tab === 'timing' && <><dl>{item(c.start, event?.startedAt ?? turn?.requestTime)}{item(c.duration, event?.durationMs ? `${event.durationMs} ms` : null)}{item(c.tokens, event?.tokens?.total)}</dl><pre>{JSON.stringify(event?.tokens ?? turn?.reported ?? {}, null, 2)}</pre><p className="hint">{locale==='zh'?'区间来自来源日志，可能包含调度或相邻记录间隔；不等于模型推理耗时。':'Intervals come from source logs and may include scheduling or gaps between records; they are not model inference latency.'}</p><p className="hint">{c.readBoundary}</p></>}
      {needsBody && <>{evidenceRecord.id!==record.id&&<p className="task-related-source"><span>{locale==='zh'?'同一原生工具身份的关联记录':'Related record with the same native tool identity'}</span><code>{evidenceRecord.id}</code>{onSelectRelated&&<button type="button" onClick={()=>onSelectRelated(evidenceRecord)}>{c.locate} ↗</button>}</p>}{body.loading && <p role="status">{c.loading}</p>}{body.error && <div role="alert"><p>{body.error}</p><button type="button" className="btn" onClick={body.retry}>{c.retry}</button></div>}{body.value && <><pre className="task-body-text">{expanded ? text : text.slice(0, previewEnd)}</pre>{previewEnd < text.length && !expanded && <><p className="hint">{c.clipped}</p><button type="button" className="btn" onClick={() => setExpanded(true)}>{c.full}</button></>}</>}</>}
      {tab === 'source' && <><dl>{item(c.source, c[context.task.origin])}{item(c.provider, context.task.provider)}{item(c.occurred, context.task.startedAt)}{item(context.task.origin === 'imported' ? c.importedAt : c.received, context.task.updatedAt)}{item(c.identity, record.id)}</dl><p className="hint">{context.task.origin === 'imported' ? c.importedBoundary : c.rawBoundary}</p>{record.sessionKey && <SessionCaptureLinksPanel sessionKey={record.sessionKey} locale={locale} invalidateKey={0} onOpenSession={onOpenSession} onOpenRequest={onOpenRequest} />}</>}
    </div>
    <footer><button type="button" className="btn" onClick={onLocate}>{c.locate} ↗</button></footer>
  </aside>;
}
