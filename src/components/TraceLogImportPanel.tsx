import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import type { TraceLogImportResult, TraceLogSession, TraceLogTurn, TraceLogTurnDetail, TraceLogPage } from '../core/trace-types.js';
import { t } from '../i18n.js';
import type { I18nKey, Locale } from '../i18n.js';

function useLoad<T>(read: (signal: AbortSignal) => Promise<T>, enabled: boolean, revision: number): { value: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ value: T | null; error: string | null; loading: boolean }>({ value: null, error: null, loading: enabled });
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setState({ value: null, error: null, loading: enabled });
    if (!enabled) return () => { current = false; controller.abort(); };
    const timer = setTimeout(() => { if (current) { current = false; controller.abort(); setState({ value: null, error: 'TRACE_IMPORT_READ_TIMEOUT', loading: false }); } }, 5000);
    void read(controller.signal).then(value => { if (current) setState({ value, error: null, loading: false }); }).catch((error: unknown) => {
      if (current) setState({ value: null, error: error instanceof ApiError ? error.code : 'TRACE_IMPORT_FAILED', loading: false });
    }).finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [read, enabled, revision]);
  return state;
}
const fields = ['system', 'messages', 'tools', 'output', 'session', 'raw'] as const;
type Field = typeof fields[number];
function fieldText(detail: TraceLogTurnDetail, field: Field): string | null {
  const key = { system: 'system_prompt', messages: 'messages', tools: 'tool_calls', output: 'output_text' };
  let value: unknown = field === 'raw' ? detail.raw : field === 'session' ? detail.session : detail.raw[key[field]];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && (field === 'messages' || field === 'tools')) {
    const original = value;
    try { value = JSON.parse(value) as unknown; } catch { return original; }
  }
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
function Pager({ offset, more, onChange, locale }: { offset: number; more: boolean; onChange: (n: number) => void; locale: Locale }): React.JSX.Element {
  return <div className="toolbar"><button className="btn" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - 20))}>{t('traceImport.previous', locale)}</button>
    <span>{offset + 1}–{offset + 20}</span><button className="btn" disabled={!more} onClick={() => onChange(offset + 20)}>{t('traceImport.next', locale)}</button></div>;
}
export function TraceLogImportPanel({ locale, stopped }: { locale: Locale; stopped: boolean }): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null), [uploading, setUploading] = useState(false), [uncertain, setUncertain] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null), [result, setResult] = useState<TraceLogImportResult | null>(null);
  const upload = useRef<AbortController | null>(null), mounted = useRef(true);
  const uploadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revision, refresh] = useState(0), [sessionOffset, setSessionOffset] = useState(0), [turnOffset, setTurnOffset] = useState(0);
  const [selected, setSelected] = useState<TraceLogSession | null>(null), [turn, setTurn] = useState<TraceLogTurn | null>(null);
  const [field, setField] = useState<Field>('messages'), [expanded, setExpanded] = useState(false), [font, setFont] = useState(13);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; upload.current?.abort(); if (uploadTimer.current !== null) clearTimeout(uploadTimer.current); }; }, []);
  const readSessions = useCallback((signal: AbortSignal) => api.traceLogImports(sessionOffset, signal), [sessionOffset]);
  const readTurns = useCallback((signal: AbortSignal) => api.traceLogTurns(selected!.id, turnOffset, signal), [selected, turnOffset]);
  const readDetail = useCallback((signal: AbortSignal) => api.traceLogTurn(selected!.id, turn!.sequence, signal), [selected, turn]);
  const sessions = useLoad<TraceLogPage<TraceLogSession>>(readSessions, true, revision);
  const turns = useLoad<TraceLogPage<TraceLogTurn>>(readTurns, selected !== null, revision);
  const detail = useLoad<TraceLogTurnDetail>(readDetail, selected !== null && turn !== null, revision);
  const select = (session: TraceLogSession): void => { setSelected(session); setTurn(null); setTurnOffset(0); setExpanded(false); };
  const doImport = async (): Promise<void> => {
    if (file === null || !stopped || upload.current !== null) return;
    if (file.size > 128 * 1024 * 1024) { setActionError('TRACE_IMPORT_LIMIT'); return; }
    const controller = new AbortController(); upload.current = controller; setUploading(true); setUncertain(false); setActionError(null); setResult(null);
    const timer = setTimeout(() => controller.abort(), 120000);
    uploadTimer.current = timer;
    try {
      const value = await api.importTraceLog(file, controller.signal);
      if (!mounted.current || upload.current !== controller) return;
      if (controller.signal.aborted) { setUncertain(true); return; }
      setResult(value); refresh(n => n + 1); setSessionOffset(0); if (value.items[0] !== undefined) select(value.items[0].session);
    } catch (error) {
      if (mounted.current && upload.current === controller) {
        if (controller.signal.aborted || !(error instanceof ApiError)) setUncertain(true);
        else setActionError(error.code);
      }
    } finally { clearTimeout(timer); if (upload.current === controller) { upload.current = null; if (mounted.current) setUploading(false); } }
  };
  const raw = detail.value !== null && selected?.id === detail.value.sessionId && turn?.sequence === detail.value.sequence ? fieldText(detail.value, field) : null;
  const label = (name: Field): string => t(`traceImport.${name}` as I18nKey, locale);
  const error = actionError ?? sessions.error ?? turns.error ?? detail.error;
  return <section aria-label={t('traceImport.title', locale)}>
    <p>{t('traceImport.scope', locale)}</p><p className="hint">{t('traceImport.limits', locale)}</p>
    <label>{t('traceImport.file', locale)} <input type="file" accept=".json,.gz,.tgz" disabled={uploading} onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
    <div className="toolbar"><button className="btn" disabled={file === null || !stopped || uploading} onClick={() => void doImport()}>{t('traceImport.upload', locale)}</button>
      {uploading && <button className="btn" onClick={() => upload.current?.abort()}>{t('traceImport.cancel', locale)}</button>}
      <button className="btn" onClick={() => refresh(n => n + 1)}>{t('traceImport.refresh', locale)}</button></div>
    {!stopped && <p>{t('traceImport.stop', locale)}</p>}
    {uploading && <p role="status">{t('traceImport.uploading', locale)}</p>}
    {uncertain && <p role="alert">{t('traceImport.uncertain', locale)}</p>}
    {error !== null && <p role="alert">{error}: {t('traceImport.error', locale)}</p>}
    {result !== null && <p role="status">{t('traceImport.success', locale)}: {result.items.filter(item => item.state === 'imported').length} / {result.items.filter(item => item.state === 'duplicate').length} / {result.ignoredEntries}</p>}
    <h3>{t('traceImport.sessions', locale)}</h3>
    {sessions.loading && <p role="status">{t('common.loading', locale)}</p>}
    {sessions.value?.items.length === 0 && <p>{t('traceImport.empty', locale)}</p>}
    {sessions.value?.items.map(session => <div key={session.id} style={{ overflowWrap: 'anywhere', marginBottom: 8 }}><button className="btn" aria-pressed={selected?.id === session.id} onClick={() => select(session)}>{session.title || session.fileName}</button>
      <div className="hint">{session.ideType ?? '—'} · {session.model ?? '—'} · {session.turnCount} {t('traceImport.turns', locale)} · {session.startedAt ?? '—'}</div></div>)}
    {sessions.value !== null && <Pager offset={sessionOffset} more={sessions.value.hasMore} onChange={setSessionOffset} locale={locale} />}
    {selected !== null && <><h3>{selected.title || selected.fileName}</h3>
      <p className="mono" style={{ overflowWrap: 'anywhere' }}>{selected.nativeSessionId} · {selected.sourceMember ?? selected.fileName}<br />SHA256 {selected.id} · {selected.source.bytes} B</p>
      <a className="btn" href={`/api/trace-imports/${selected.id}/source`} download>{t('traceImport.source', locale)}</a>
      <p className="hint">{t('traceImport.reported', locale)}</p><h4>{t('traceImport.turns', locale)}</h4>
      {turns.loading && <p role="status">{t('common.loading', locale)}</p>}
      {turns.value?.items.map(item => <div key={item.sequence} style={{ marginBottom: 6 }}><button className="btn" aria-pressed={turn?.sequence === item.sequence} onClick={() => { setTurn(item); setExpanded(false); }}>#{item.turnNumber ?? item.sequence + 1} · {item.model ?? '—'} · {item.requestTime ?? '—'}{item.isError === true ? ' ⚠' : ''}</button></div>)}
      {turns.value !== null && <Pager offset={turnOffset} more={turns.value.hasMore} onChange={n => { setTurnOffset(n); setTurn(null); }} locale={locale} />}
    </>}
    {turn !== null && <><h4>#{turn.turnNumber ?? turn.sequence + 1} · {turn.turnId ?? '—'}</h4>
      <details><summary>{t('traceImport.reported', locale)}</summary><pre>{JSON.stringify(turn.reported, null, 2)}</pre></details>
      <div className="toolbar" role="tablist" aria-label={t('traceImport.turns', locale)}>{fields.map(name => <button key={name} className="btn" role="tab" aria-selected={field === name} onClick={() => { setField(name); setExpanded(false); }}>{label(name)}</button>)}</div>
      {detail.loading && <p role="status">{t('common.loading', locale)}</p>}
      {detail.value !== null && <div role="tabpanel" aria-label={label(field)}>
        <div className="toolbar"><button className="btn" onClick={() => setFont(n => Math.max(8, n - 1))}>A−</button><button className="btn" onClick={() => setFont(n => Math.min(28, n + 1))}>A+</button><button className="btn" onClick={() => setFont(13)}>R</button></div>
        {raw === null ? <p>{t(field === 'output' ? 'traceImport.missingOutput' : 'traceImport.missing', locale)}</p> : <>
          {raw.length > 65536 && !expanded && <p>{t('traceImport.preview', locale)} <button className="btn" onClick={() => setExpanded(true)}>{t('traceImport.expand', locale)}</button></p>}
          <pre style={{ fontSize: font, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '55vh', overflow: 'auto' }}>{expanded ? raw : raw.slice(0, 65536)}</pre>
        </>}
      </div>}
    </>}
  </section>;
}
