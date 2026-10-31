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
type Detail = TraceEvent | TraceEventRaw | TraceLogTurnDetail;
function field(detail: Detail | null, name: 'input' | 'output' | 'raw'): unknown {
  if (!detail) return null;
  if ('session' in detail && 'raw' in detail) {
    const value = (detail as TraceLogTurnDetail).raw;
    return name === 'raw' ? value : name === 'input' ? value.messages ?? value.system_prompt : value.output_text;
  }
  const value = detail as TraceEventRaw;
  return name === 'raw' ? value.raw : name === 'input' ? value.inputSummary : value.outputSummary;
}
function EvidenceText({ value, locale, size }: { value: unknown; locale: Locale; size: number }) {
  const c = copy(locale), [expanded, setExpanded] = useState(false);
  const text = value === null || value === undefined || value === '' ? c.missing : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  let end = 0, bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!, count = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + count > 65536) break;
    bytes += count; end += character.length;
  }
  return <><pre className="task-body-text" style={{ fontSize: size }}>{expanded ? text : text.slice(0, end)}</pre>{end < text.length && !expanded && <><p className="hint">{c.clipped}</p><button type="button" className="btn" onClick={() => setExpanded(true)}>{c.full}</button></>}</>;
}

/** Selecting a row is the explicit body-read action. Summary opens its useful
 * content immediately; only an exact retained tool pair can add one companion. */
export function TaskEvidence({ context, record, relatedRecords = [], onSelectRelated, locale, initialRaw, onClose, onLocate, onOpenRequest, onOpenSession }: {
  context: TaskContext; record: TaskRecord; locale: Locale; initialRaw: boolean; onClose: () => void;
  relatedRecords?: TaskRecord[]; onSelectRelated?: (record: TaskRecord) => void;
  onLocate: () => void; onOpenRequest: (id: number) => void; onOpenSession: (key: string) => void;
}): React.JSX.Element {
  const c = copy(locale), [tab, setTab] = useState<Tab>(initialRaw ? 'rawBody' : 'summary');
  const [size, setSize] = useState(13), [width, setWidth] = useState<number | null>(null), [wide, setWide] = useState(false);
  const cache = useRef(new Map<string, Detail>()), closeButton = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => pushOverlay(onClose), [onClose]);
  useEffect(() => { const prior = document.activeElement; closeButton.current?.focus({ preventScroll: true }); return () => { if (prior instanceof HTMLElement && prior.isConnected) prior.focus({ preventScroll: true }); }; }, []);
  const raw = tab === 'rawBody', needsBody = ['summary', 'input', 'output', 'rawBody'].includes(tab);
  const evidenceRecord = tab === 'input' && !record.event?.hasInput ? relatedRecords.find(item => item.event?.hasInput) ?? record
    : tab === 'output' && !record.event?.hasOutput ? [...relatedRecords].reverse().find(item => item.event?.hasOutput) ?? record : record;
  const companion = !record.event?.hasInput ? relatedRecords.find(item => item.id !== record.id && item.event?.hasInput)
    : !record.event.hasOutput ? [...relatedRecords].reverse().find(item => item.id !== record.id && item.event?.hasOutput) : undefined;
  const readRecord = useCallback(async (target: TaskRecord, original: boolean, signal: AbortSignal): Promise<Detail> => {
    const key = target.id + (original ? ':raw' : ':body'), existing = cache.current.get(key);
    if (existing) return existing;
    const result = target.event && target.sessionKey
      ? await api.eventDetail(target.sessionKey, target.event.id, original, signal)
      : await api.traceLogTurn(context.importSession!.id, target.importedTurn!.sequence, signal);
    if (!signal.aborted) cache.current.set(key, result);
    return result;
  }, [context.importSession]);
  const read = useCallback((signal: AbortSignal) => readRecord(evidenceRecord, raw, signal), [evidenceRecord, raw, readRecord]);
  const readCompanion = useCallback((signal: AbortSignal) => readRecord(companion!, false, signal), [companion, readRecord]);
  const body = useTaskRead(needsBody ? evidenceRecord.id + (raw ? ':raw' : ':body') : null, read, 10000);
  const paired = useTaskRead(tab === 'summary' && companion ? companion.id + ':body' : null, readCompanion, 10000);
  const event = record.event, turn = record.importedTurn, title = event?.title || `${c.sequence} ${event?.sequence ?? turn?.sequence ?? ''}`;
  const tool = Boolean(event && ['tool', 'bash', 'file_read', 'file_write', 'test'].includes(event.kind));
  const state = event?.status ?? (turn?.isError === null ? c.statusUnknown : turn?.isError ? c.statusError : c.statusSuccess);
  const inputRead = event?.hasInput || !companion?.event?.hasInput ? body : paired;
  const outputRead = event?.hasOutput || !companion?.event?.hasOutput ? body : paired;
  const input = field(inputRead.value, 'input'), output = field(outputRead.value, 'output');
  const item = (label: string, value: string | number | null | undefined) => <div><dt>{label}</dt><dd>{value ?? '—'}</dd></div>;
  const boundedWidth = (value: number) => Math.max(280, Math.min(900, value, (panel.current?.parentElement?.clientWidth ?? 1000) * 0.75));
  const errors = <>{body.error && <div role="alert"><p>{body.error}</p><button type="button" className="btn" onClick={body.retry}>{c.retry}</button></div>}{paired.error && <div role="alert"><p>{paired.error}</p><button type="button" className="btn" onClick={paired.retry}>{c.retry}</button></div>}</>;
  return <aside ref={panel} className={`task-evidence ${wide ? 'is-wide' : ''}`} aria-label={c.inspect} style={width !== null && !wide ? { width } : undefined}>
    <div className="task-evidence-resize" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={locale === 'zh' ? '调整详情宽度' : 'Resize evidence'} aria-valuemin={280} aria-valuemax={900} aria-valuenow={Math.round(width ?? 500)}
      onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); setWide(false); setWidth(boundedWidth(e.key === 'Home' ? 280 : e.key === 'End' ? 900 : (width ?? panel.current?.clientWidth ?? 500) + (e.key === 'ArrowLeft' ? 24 : -24))); }}
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); drag.current = { x: e.clientX, width: panel.current?.clientWidth ?? 500 }; e.currentTarget.setPointerCapture?.(e.pointerId); setWide(false); }}
      onPointerMove={e => { if (drag.current) setWidth(boundedWidth(drag.current.width + drag.current.x - e.clientX)); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
    <header><div><span className={`task-evidence-kind ${tool ? 'tool' : event?.kind === 'reasoning' ? 'reasoning' : 'model'}`}>{tool ? locale === 'zh' ? '工具' : 'Tool' : event?.kind === 'reasoning' ? locale === 'zh' ? '思考' : 'Reasoning' : event?.kind === 'user_prompt' ? locale === 'zh' ? '用户' : 'User' : locale === 'zh' ? '模型' : 'Model'}</span><h3 title={title}>{title}</h3></div><button type="button" className="ui-icon-btn" title={locale === 'zh' ? '展开阅读宽度' : 'Expand reading width'} aria-label={locale === 'zh' ? '展开阅读宽度' : 'Expand reading width'} aria-pressed={wide} onClick={() => setWide(value => !value)}>⤢</button><button ref={closeButton} type="button" className="ui-icon-btn" aria-label={c.close} onClick={onClose}>×</button></header>
    <div className="task-evidence-tabs" role="tablist" aria-label={c.inspect}>{(['summary', 'input', 'output', 'timing', 'rawBody', 'source'] as const).map(value => <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{c[value]}</button>)}</div>
    <div className="task-evidence-content" role="tabpanel">
      <div className="task-evidence-quick-meta"><span>{record.memberName}</span><span>{event?.kind ?? 'TraceLog'} · {state}</span><span className="task-text-controls"><button type="button" aria-label={locale === 'zh' ? '减小正文' : 'Decrease evidence text'} disabled={size <= 8} onClick={() => setSize(value => Math.max(8, value - 1))}>A−</button><button type="button" aria-label={locale === 'zh' ? '增大正文' : 'Increase evidence text'} disabled={size >= 28} onClick={() => setSize(value => Math.min(28, value + 1))}>A＋</button><button type="button" aria-label={locale === 'zh' ? '重置正文' : 'Reset evidence text'} onClick={() => setSize(13)}>R</button></span></div>
      {event?.error && <p className="task-evidence-error" role="alert" tabIndex={0}>{event.error}</p>}
      {needsBody && <>{(body.loading || paired.loading) && <p role="status">{c.loading}</p>}{errors}</>}
      {tab === 'summary' && <>
        {body.value && <>{(tool || event?.hasInput || event?.kind === 'user_prompt' || !event) && <section className="task-evidence-block"><h4>{tool ? locale === 'zh' ? '参数' : 'Parameters' : c.input}</h4>{inputRead.loading ? <p role="status">{c.loading}</p> : !inputRead.error && <EvidenceText key={'input:' + record.id} value={input} locale={locale} size={size} />}</section>}
          {(tool || event?.kind !== 'user_prompt') && <section className="task-evidence-block"><h4>{tool ? locale === 'zh' ? '结果' : 'Result' : event?.kind === 'reasoning' ? locale === 'zh' ? '模型思考' : 'Model reasoning' : locale === 'zh' ? '模型输出' : 'Model output'}</h4>{outputRead.loading ? <p role="status">{c.loading}</p> : !outputRead.error && <EvidenceText key={'output:' + record.id} value={output} locale={locale} size={size} />}</section>}</>}
        {companion && <p className="task-related-source">{locale === 'zh' ? '参数与结果来自同一原生工具身份的记录。' : 'Input and output come from records sharing the same native tool identity.'}{onSelectRelated && <button type="button" onClick={() => onSelectRelated(companion)}>{c.locate} ↗</button>}</p>}
        <details className="task-evidence-metadata"><summary>{locale === 'zh' ? '记录信息与证据边界' : 'Record information and evidence scope'}</summary><dl>{item(c.member, record.memberName)}{item(c.sequence, event?.sequence ?? turn?.sequence)}{item(c.start, event?.startedAt ?? turn?.requestTime)}{item(c.identity, record.id)}</dl><p className="hint">{context.task.origin === 'imported' ? c.importedBoundary : c.rawBoundary}</p></details>
      </>}
      {tab === 'timing' && <><dl>{item(c.start, event?.startedAt ?? turn?.requestTime)}{item(c.duration, event?.durationMs ? `${event.durationMs} ms` : null)}{item(c.tokens, event?.tokens?.total)}</dl><pre>{JSON.stringify(event?.tokens ?? turn?.reported ?? {}, null, 2)}</pre><p className="hint">{locale === 'zh' ? '区间来自来源日志，可能包含调度或相邻记录间隔；不等于模型推理耗时。' : 'Intervals come from source logs and may include scheduling or gaps; they are not model inference latency.'}</p></>}
      {['input', 'output', 'rawBody'].includes(tab) && <>{evidenceRecord.id !== record.id && <p className="task-related-source">{locale === 'zh' ? '同一原生工具身份的关联记录' : 'Related record with the same native tool identity'}<code>{evidenceRecord.id}</code></p>}{body.value && <EvidenceText key={evidenceRecord.id + ':' + tab} value={field(body.value, raw ? 'raw' : tab === 'input' ? 'input' : 'output')} locale={locale} size={size} />}</>}
      {tab === 'source' && <><dl>{item(c.source, c[context.task.origin])}{item(c.provider, context.task.provider)}{item(c.occurred, context.task.startedAt)}{item(context.task.origin === 'imported' ? c.importedAt : c.received, context.task.updatedAt)}{item(c.identity, record.id)}</dl><p className="hint">{context.task.origin === 'imported' ? c.importedBoundary : c.rawBoundary}</p>{record.sessionKey && <SessionCaptureLinksPanel sessionKey={record.sessionKey} locale={locale} invalidateKey={0} onOpenSession={onOpenSession} onOpenRequest={onOpenRequest} />}</>}
    </div>
    <footer><button type="button" className="btn" onClick={onLocate}>{c.locate} ↗</button><button type="button" className="task-evidence-network" onClick={() => setTab('source')}>{locale === 'zh' ? '网络请求对照 ↗' : 'Network evidence ↗'}</button></footer>
  </aside>;
}
