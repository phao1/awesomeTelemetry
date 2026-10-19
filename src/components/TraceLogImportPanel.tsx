import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import type { TraceLogImportResult, TraceLogPage, TraceLogSession, TraceLogTurn, TraceLogTurnDetail } from '../core/trace-types.js';
import { t, type I18nKey, type Locale } from '../i18n.js';
import { Tabs } from './ui/Tabs.js';

/** An identity/retry generation owns its read, even if the transport ignores abort. */
function useLoad<T>(identity: string | null, read: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0);
  const key = identity === null ? null : `${identity}:${revision}`;
  const [state, setState] = useState<{ key: string | null; value: T | null; error: string | null; loading: boolean }>({ key: null, value: null, error: null, loading: false });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ key, value: null, error: null, loading: key !== null });
    if (key === null) return () => { current = false; controller.abort(); };
    const timer = setTimeout(() => {
      if (!current) return;
      current = false; controller.abort();
      setState({ key, value: null, error: 'TRACE_IMPORT_READ_TIMEOUT', loading: false });
    }, 5000);
    void read(controller.signal).then(value => {
      if (current) setState({ key, value, error: null, loading: false });
    }).catch((error: unknown) => {
      if (current) setState({ key, value: null, error: error instanceof ApiError ? error.code : 'TRACE_IMPORT_FAILED', loading: false });
    }).finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [key, read]);
  const retry = useCallback(() => setRevision(n => n + 1), []);
  // Do not wait for the passive effect to clear a prior identity's content.
  return { ...(state.key === key ? state : { value: null, error: null, loading: key !== null }), revision, retry };
}

const fields = ['system', 'messages', 'tools', 'output', 'session', 'raw'] as const;
type Field = typeof fields[number];
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nullableText = (value: unknown): boolean => value === null || typeof value === 'string';
function validSession(value: unknown): value is TraceLogSession {
  return object(value) && typeof value.id === 'string' && /^[a-f0-9]{64}$/.test(value.id)
    && typeof value.fileName === 'string' && typeof value.importedAt === 'string'
    && ['sourceMember', 'nativeSessionId', 'ideType', 'model', 'title', 'startedAt', 'endedAt'].every(key => nullableText(value[key]))
    && Number.isSafeInteger(value.turnCount) && (value.turnCount as number) >= 0
    && object(value.source) && Number.isSafeInteger(value.source.bytes) && (value.source.bytes as number) >= 0;
}
function validTurn(value: unknown): value is TraceLogTurn {
  return object(value) && Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0 && (value.sequence as number) < 2000
    && ['turnId', 'model', 'requestTime', 'responseTime'].every(key => nullableText(value[key]))
    && (value.turnNumber === null || typeof value.turnNumber === 'number')
    && (value.isError === null || typeof value.isError === 'boolean') && typeof value.hasOutput === 'boolean' && object(value.reported);
}
function checkedPage<T>(value: TraceLogPage<T>, offset: number, valid: (item: unknown) => item is T): TraceLogPage<T> {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > 20 || !value.items.every(valid)
    || value.offset !== offset || value.limit !== 20 || typeof value.hasMore !== 'boolean') throw new ApiError('TRACE_IMPORT_INVALID_RESPONSE', 'Invalid metadata page');
  return value;
}
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

/** Count only the bounded prefix; UTF-16 length is not the UTF-8 preview budget. */
function previewText(text: string): { text: string; truncated: boolean } {
  let bytes = 0, end = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > 65536) return { text: text.slice(0, end), truncated: true };
    bytes += size; end += character.length;
  }
  return { text, truncated: false };
}

function ReadState({ loading, error, locale }: { loading: boolean; error: string | null; locale: Locale }): React.JSX.Element | null {
  if (loading) return <p role="status" className="hint">{t('common.loading', locale)}</p>;
  if (error !== null) return <p role="alert"><span className="mono">{error}</span> · {t('traceImport.readError', locale)}</p>;
  return null;
}

function Pager({ offset, count, more, maxOffset, name, onChange, locale }: {
  offset: number; count: number; more: boolean; maxOffset: number; name: string;
  onChange: (n: number) => void; locale: Locale;
}): React.JSX.Element {
  const atLimit = more && offset + 20 > maxOffset;
  return <nav className="trace-import-pager" aria-label={name}>
    <button type="button" className="btn" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - 20))}>{t('traceImport.previous', locale)}</button>
    <span className="mono">{count === 0 ? '0' : `${offset + 1}–${offset + count}`}</span>
    <button type="button" className="btn" disabled={!more || atLimit} onClick={() => onChange(offset + 20)}>{t('traceImport.next', locale)}</button>
    {atLimit && <span className="hint">{t('traceImport.pageLimit', locale)}</span>}
  </nav>;
}

interface Upload { controller: AbortController; timer: ReturnType<typeof setTimeout> }

export function TraceLogImportPanel({ locale, stopped }: { locale: Locale; stopped: boolean }): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null), [uploading, setUploading] = useState(false);
  const [uncertainRevision, setUncertainRevision] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null), [result, setResult] = useState<TraceLogImportResult | null>(null);
  const upload = useRef<Upload | null>(null);
  const [sessionOffset, setSessionOffset] = useState(0), [turnOffset, setTurnOffset] = useState(0);
  const [selected, setSelected] = useState<TraceLogSession | null>(null), [turn, setTurn] = useState<TraceLogTurn | null>(null);
  const [field, setField] = useState<Field>('messages'), [expanded, setExpanded] = useState(false), [font, setFont] = useState(13);
  const selectedId = selected?.id ?? null, sequence = turn?.sequence ?? null;
  const readSessions = useCallback(async (signal: AbortSignal) => checkedPage(await api.traceLogImports(sessionOffset, signal), sessionOffset, validSession), [sessionOffset]);
  const readTurns = useCallback(async (signal: AbortSignal) => checkedPage(await api.traceLogTurns(selectedId!, turnOffset, signal), turnOffset, validTurn), [selectedId, turnOffset]);
  const readDetail = useCallback(async (signal: AbortSignal) => {
    const value = await api.traceLogTurn(selectedId!, sequence!, signal);
    if (!object(value) || value.sessionId !== selectedId || value.sequence !== sequence || !object(value.raw) || !object(value.session)) throw new ApiError('TRACE_IMPORT_INVALID_RESPONSE', 'Invalid selected turn');
    return value;
  }, [selectedId, sequence]);
  const sessions = useLoad(`sessions:${sessionOffset}`, readSessions);
  const turns = useLoad(selectedId === null ? null : `turns:${selectedId}:${turnOffset}`, readTurns);
  const detail = useLoad(selectedId === null || sequence === null ? null : `detail:${selectedId}:${sequence}`, readDetail);
  const needsRecovery = uncertainRevision !== null && !(sessions.value !== null && sessions.revision > uncertainRevision);
  useEffect(() => {
    if (uncertainRevision !== null && sessions.value !== null && sessions.revision > uncertainRevision) setUncertainRevision(null);
  }, [uncertainRevision, sessions.value, sessions.revision]);
  const select = (session: TraceLogSession): void => { setSelected(session); setTurn(null); setTurnOffset(0); setExpanded(false); };
  const chooseTurn = (value: TraceLogTurn): void => { setTurn(value); setField('messages'); setExpanded(false); };
  useEffect(() => () => {
    const active = upload.current; upload.current = null;
    if (active !== null) { clearTimeout(active.timer); active.controller.abort(); }
  }, []);
  const stopWaiting = (active: Upload): void => {
    if (upload.current !== active) return;
    upload.current = null; clearTimeout(active.timer); active.controller.abort();
    setUploading(false); setUncertainRevision(sessions.revision); setResult(null);
  };
  const doImport = async (): Promise<void> => {
    if (file === null || !stopped || needsRecovery || upload.current !== null) return;
    if (file.size > 128 * 1024 * 1024) { setActionError('TRACE_IMPORT_LIMIT'); return; }
    if (file.size === 0 || file.name.length > 512 || !/\.(?:json|gz|tgz)$/i.test(file.name)) { setActionError('TRACE_IMPORT_INVALID'); return; }
    const active: Upload = { controller: new AbortController(), timer: setTimeout(() => stopWaiting(active), 120000) };
    upload.current = active; setUploading(true); setActionError(null); setResult(null);
    try {
      const value = await api.importTraceLog(file, active.controller.signal);
      if (upload.current !== active) return;
      if (!Array.isArray(value.items) || !Number.isSafeInteger(value.ignoredEntries) || value.ignoredEntries < 0
        || value.items.some(item => !['imported', 'duplicate'].includes(item.state) || !validSession(item.session))) {
        stopWaiting(active); return;
      }
      setResult(value); setUncertainRevision(null); setSessionOffset(0); sessions.retry();
      if (value.items[0] !== undefined) select(value.items[0].session);
    } catch (error) {
      if (upload.current !== active) return;
      if (active.controller.signal.aborted || !(error instanceof ApiError)) stopWaiting(active);
      else setActionError(error.code);
    } finally {
      clearTimeout(active.timer);
      if (upload.current === active) { upload.current = null; setUploading(false); }
    }
  };
  const raw = useMemo(() => detail.value === null ? null : fieldText(detail.value, field), [detail.value, field]);
  const preview = useMemo(() => raw === null ? null : previewText(raw), [raw]);
  const label = (name: Field): string => t(`traceImport.${name}` as I18nKey, locale);
  return <section className="trace-import-workbench" aria-label={t('traceImport.title', locale)}>
    <div className="trace-import-intro"><strong>{t('traceImport.offline', locale)}</strong><p className="hint">{t('traceImport.flow', locale)}</p></div>
    {!stopped && <p role="status" className="hint">{t('traceImport.stop', locale)}</p>}
    <details className="admin-surface trace-import-upload"><summary>{t('traceImport.newFile', locale)} <span className="hint">.json / .gz / .tgz</span></summary>
      <p>{t('traceImport.scope', locale)}</p><p className="hint">{t('traceImport.limits', locale)}</p>
      <label className="trace-import-file">{t('traceImport.file', locale)}<input type="file" accept=".json,.gz,.tgz,.tar.gz" disabled={uploading} onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setActionError(null); setResult(null); }} /></label>
      {file !== null && <p className="mono hint">{file.name} · {file.size.toLocaleString(locale)} B</p>}
      <div className="admin-toolbar"><button type="button" className="btn ui-btn-primary" disabled={file === null || !stopped || uploading || needsRecovery} onClick={() => void doImport()}>{t('traceImport.upload', locale)}</button>
        {uploading && <button type="button" className="btn" onClick={() => { if (upload.current !== null) stopWaiting(upload.current); }}>{t('traceImport.cancel', locale)}</button>}
      </div><p className="hint">{t('traceImport.cancelHint', locale)}</p>
    </details>
    {uploading && <p role="status">{t('traceImport.uploading', locale)}</p>}
    {needsRecovery && <p role="alert">{t('traceImport.uncertain', locale)}</p>}
    {actionError !== null && <p role="alert">{actionError}: {t('traceImport.error', locale)}</p>}
    {result !== null && <p role="status">{t('traceImport.success', locale)}: {result.items.filter(item => item.state === 'imported').length} / {result.items.filter(item => item.state === 'duplicate').length} / {result.ignoredEntries}</p>}
    <div className="trace-import-layout">
      <section className="trace-import-sessions" aria-label={t('traceImport.sessions', locale)}>
        <div className="admin-section-heading"><h3>{t('traceImport.sessions', locale)}</h3><button type="button" className="btn" disabled={sessions.loading || uploading} onClick={sessions.retry}>{t('traceImport.refresh', locale)}</button></div>
        <ReadState loading={sessions.loading} error={sessions.error} locale={locale}/>
        {sessions.value?.items.length === 0 && <p className="hint">{t('traceImport.empty', locale)}</p>}
        <div className="trace-import-session-list">{sessions.value?.items.map(session => <div key={session.id} className="trace-import-session" data-selected={selectedId === session.id}>
          <button type="button" className="trace-import-choice" aria-pressed={selectedId === session.id} onClick={() => select(session)}>{session.title || session.fileName}</button>
          <span className="hint">{session.ideType ?? '—'} · {session.model ?? '—'} · {session.turnCount} {t('traceImport.turns', locale)}</span><time className="hint">{session.startedAt ?? '—'}</time>
        </div>)}</div>
        {sessions.value !== null && <Pager offset={sessionOffset} count={sessions.value.items.length} more={sessions.value.hasMore} maxOffset={1024} name={t('traceImport.sessionPages', locale)} onChange={setSessionOffset} locale={locale}/>}
      </section>
      <section className="trace-import-investigation" aria-label={t('traceImport.selected', locale)}>
        {selected === null ? <div className="trace-import-empty"><h3>{t('traceImport.selectSession', locale)}</h3><p className="hint">{t('traceImport.selectHint', locale)}</p></div> : <>
          <header className="admin-section-heading"><h3>{selected.title || selected.fileName}</h3><a className="btn" href={`/api/trace-imports/${selected.id}/source`} download>{t('traceImport.source', locale)}</a></header>
          <details className="trace-import-provenance"><summary>{t('traceImport.provenance', locale)}</summary><dl>
            <div><dt>{t('traceImport.nativeId', locale)}</dt><dd>{selected.nativeSessionId ?? '—'}</dd></div>
            <div><dt>{t('traceImport.file', locale)}</dt><dd>{selected.sourceMember ?? selected.fileName}</dd></div>
            <div><dt>SHA256</dt><dd className="mono">{selected.id}</dd></div>
            <div><dt>{t('traceImport.importedAt', locale)}</dt><dd>{selected.importedAt} · {selected.source.bytes.toLocaleString(locale)} B</dd></div>
          </dl><p className="hint">{t('traceImport.reported', locale)}</p></details>
          <div className="admin-section-heading"><h4>{t('traceImport.turns', locale)}</h4><button type="button" className="btn" disabled={turns.loading} onClick={turns.retry}>{t(turns.error === null ? 'traceImport.refreshTurns' : 'traceImport.retryTurns', locale)}</button></div>
          <ReadState loading={turns.loading} error={turns.error} locale={locale}/>
          {turns.value?.items.length === 0 && <p className="hint">{t('traceImport.noTurns', locale)}</p>}
          <div className="trace-import-turn-list">{turns.value?.items.map(item => <button key={item.sequence} type="button" className="trace-import-choice" aria-pressed={sequence === item.sequence} onClick={() => chooseTurn(item)}>
            #{item.turnNumber ?? item.sequence + 1} · {item.model ?? '—'} · {item.requestTime ?? '—'}<span className="hint">{t(item.isError === null ? 'traceImport.unknownStatus' : item.isError ? 'traceImport.reportedError' : 'traceImport.noReportedError', locale)} · {t(item.hasOutput ? 'traceImport.hasOutput' : 'traceImport.noOutput', locale)}</span>
          </button>)}</div>
          {turns.value !== null && <Pager offset={turnOffset} count={turns.value.items.length} more={turns.value.hasMore} maxOffset={2000} name={t('traceImport.turnPages', locale)} onChange={n => { setTurnOffset(n); setTurn(null); }} locale={locale}/>}
          {turn === null ? <p className="trace-import-empty hint">{t('traceImport.selectTurn', locale)}</p> : <section className="trace-import-evidence" aria-label={t('traceImport.selectedTurn', locale)}>
            <div className="admin-section-heading"><h4>#{turn.turnNumber ?? turn.sequence + 1} · {turn.turnId ?? '—'}</h4><button type="button" className="btn" disabled={detail.loading} onClick={detail.retry}>{t(detail.error === null ? 'traceImport.refreshTurn' : 'traceImport.retryTurn', locale)}</button></div>
            <details><summary>{t('traceImport.reportedMetrics', locale)}</summary><p className="hint">{t('traceImport.reported', locale)}</p><pre>{JSON.stringify(turn.reported, null, 2)}</pre></details>
            <div className="trace-import-fields" role="group" aria-label={t('traceImport.fields', locale)}><Tabs items={fields.map(name => ({ id: name, label: label(name) }))} activeId={field} onChange={name => { setField(name as Field); setExpanded(false); }}/></div>
            <ReadState loading={detail.loading} error={detail.error} locale={locale}/>
            {detail.value !== null && <div role="tabpanel" aria-label={label(field)}>
              <div className="admin-toolbar"><button type="button" className="btn" aria-label={t('traceImport.fontDecrease', locale)} disabled={font === 8} onClick={() => setFont(n => Math.max(8, n - 1))}>A−</button><button type="button" className="btn" aria-label={t('traceImport.fontIncrease', locale)} disabled={font === 28} onClick={() => setFont(n => Math.min(28, n + 1))}>A+</button><button type="button" className="btn" aria-label={t('traceImport.fontReset', locale)} onClick={() => setFont(13)}>R</button></div>
              {raw === null ? <p className="hint">{t(field === 'output' ? 'traceImport.missingOutput' : 'traceImport.missing', locale)}</p> : <>
                {preview?.truncated && <p className="hint">{t(expanded ? 'traceImport.fullField' : 'traceImport.preview', locale)} <button type="button" className="btn" onClick={() => setExpanded(value => !value)}>{t(expanded ? 'traceImport.collapse' : 'traceImport.expand', locale)}</button></p>}
                <pre className="trace-import-body" style={{ fontSize: font }}>{expanded ? raw : preview?.text}</pre>
              </>}
            </div>}
          </section>}
        </>}
      </section>
    </div>
  </section>;
}
