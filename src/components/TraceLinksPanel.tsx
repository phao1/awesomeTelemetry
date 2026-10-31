import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { ProxyTraceLinkPage, SessionCaptureLinkPage, SessionIndexEntry, TraceAssociationDecision, TraceAssociationState, TraceIdentityPage } from '../core/trace-types.js';
import { t, type Locale } from '../i18n.js';
import { Badge } from './ui/Badge.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { IconSearch } from './icons/index.js';

const LinkedExecutionPanel = lazy(() => import('./LinkedExecutionPanel.js').then(module => ({ default: module.LinkedExecutionPanel })));
const NativeSessionParentsPanel = lazy(() => import('./NativeSessionParentsPanel.js').then(module => ({ default: module.NativeSessionParentsPanel })));
const SessionFamilyPanel = lazy(() => import('./SessionFamilyPanel.js').then(module => ({ default: module.SessionFamilyPanel })));
const ToolExecutionPanel = lazy(() => import('./ToolExecutionPanel.js').then(module => ({ default: module.ToolExecutionPanel })));
const TraceExportPanel = lazy(() => import('./TraceExportPanel.js').then(module => ({ default: module.TraceExportPanel })));
const LinkedTraceExportPanel = lazy(() => import('./LinkedTraceExportPanel.js').then(module => ({ default: module.LinkedTraceExportPanel })));

const stateKeys = {
  direct: 'trace.links.direct', candidate: 'trace.links.candidate', confirmed: 'trace.links.confirmed',
  rejected: 'trace.links.rejected', revoked: 'trace.links.revoked',
} as const satisfies Record<TraceAssociationState, string>;
function LinkState({ state, locale }: { state: TraceAssociationState; locale: Locale }): React.JSX.Element {
  return <Badge tone={state === 'direct' || state === 'confirmed' ? 'success' : state === 'candidate' ? 'attention' : 'neutral'}>{t(stateKeys[state], locale)}</Badge>;
}
function IdentityList({ page, locale, onNext, onFirst }: {
  page: TraceIdentityPage; locale: Locale; onNext: () => void; onFirst: () => void;
}): React.JSX.Element {
  return (
    <div>
      <p className="hint mono">{page.source} · {page.sourceKey} · parser {page.parserVersion ?? '—'}</p>
      {!page.completeness.complete && <p role="status">{t('trace.links.incomplete', locale)}: {page.completeness.reasons.join(', ')}</p>}
      {page.items.length === 0 && <p className="hint">{t('trace.links.noIdentities', locale)}</p>}
      {page.items.map(identity => <details key={identity.id}>
        <summary><span className="mono">{identity.namespace} · {identity.kind} · {identity.value}</span></summary>
        <p className="hint mono">{identity.sourcePath}</p>
        <p className="mono">scope: {identity.scope ?? '—'} · event: {identity.eventId ?? '—'}</p>
        <p className="hint mono">{identity.id}</p>
      </details>)}
      <button className="btn" type="button" onClick={onFirst}>{t('trace.links.first', locale)}</button>
      {page.hasMore && <button className="btn" type="button" onClick={onNext}>{t('trace.links.next', locale)}</button>}
    </div>
  );
}

/** Mounted only after explicitly selecting the trace tab; exactly two initial metadata requests. */
export function ProxyTraceLinksPanel({ proxyId, sessions, locale, invalidateKey = 0, onOpenSession }: {
  proxyId: number; sessions: SessionIndexEntry[]; locale: Locale; invalidateKey?: number; onOpenSession?: (key: string) => void;
}): React.JSX.Element {
  const [page, setPage] = useState<ProxyTraceLinkPage | null>(null);
  const [identities, setIdentities] = useState<TraceIdentityPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionKey, setSessionKey] = useState('');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<{ key: string; items: TraceAssociationDecision[]; hasMore: boolean; nextCursor: number | null } | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const version = useRef(invalidateKey);
  const generation = useRef(0);
  useEffect(() => { version.current = invalidateKey; }, [invalidateKey]);
  const load = useCallback(async (cursor?: string) => {
    const token = ++generation.current; const atVersion = version.current;
    setBusy(true); setError(null);
    try {
      const [links, source] = await Promise.all([api.proxyTraceLinks(proxyId, cursor), api.proxyIdentities(proxyId)]);
      if (token !== generation.current) return;
      setPage(links); setIdentities(source); setLoadedVersion(atVersion);
    } catch (error: unknown) {
      if (token === generation.current) setError(error instanceof Error ? error.message : String(error));
    } finally { if (token === generation.current) setBusy(false); }
  }, [proxyId]);
  useEffect(() => {
    setPage(null); setIdentities(null); setHistory(null); setSessionKey(''); setNote(''); setLoadedVersion(-1);
    void load();
    return () => { generation.current += 1; };
  }, [load]);
  const options = useMemo(() => sessions.filter(session => session.dataSource === 'scan' &&
    (sessionKey === '' || session.id.toLowerCase().includes(sessionKey.toLowerCase()) || session.title.toLowerCase().includes(sessionKey.toLowerCase()))).slice(0, 20), [sessions, sessionKey]);
  const decide = async (key: string, state: TraceAssociationDecision['state']): Promise<void> => {
    const token = ++generation.current;
    setBusy(true); setError(null);
    try {
      await api.decideTraceLink(proxyId, key, state, note === '' ? null : note);
      if (token !== generation.current) return;
      setHistory(null); await load();
    } catch (error: unknown) { if (token === generation.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const readIdentityPage = async (source: 'scan' | 'proxy', key: string, cursor?: string): Promise<void> => {
    const token = ++generation.current;
    setBusy(true); setError(null);
    try {
      const result = source === 'scan' ? await api.sessionIdentities(key, cursor) : await api.proxyIdentities(Number(key), cursor);
      if (token === generation.current) setIdentities(result);
    } catch (error: unknown) { if (token === generation.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const readHistory = async (key: string, cursor?: number): Promise<void> => {
    const token = ++generation.current;
    setBusy(true); setError(null);
    try { const result = await api.traceLinkDecisions(proxyId, key, cursor); if (token === generation.current) setHistory({ key, ...result }); }
    catch (error: unknown) { if (token === generation.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (token === generation.current) setBusy(false); }
  };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p className="hint">{t('trace.links.hint', locale)}</p>
      {loadedVersion >= 0 && loadedVersion !== invalidateKey && <p role="status">{t('trace.links.stale', locale)}</p>}
      <button className="btn" type="button" disabled={busy} onClick={() => void load()}>{t('trace.links.refresh', locale)}</button>
      {busy && <Skeleton count={1} />}
      {error !== null && <ErrorState code="TRACE_LINKS_FAILED" message={error} onRetry={() => void load()} />}
      {page !== null && page.items.length === 0 && <p className="hint">{t('trace.links.empty', locale)}</p>}
      {page?.items.map(link => (
        <div key={link.id}>
          <LinkState state={link.state} locale={locale} />
          <button className="btn" type="button" disabled={onOpenSession === undefined} onClick={() => onOpenSession?.(link.sessionKey)}>{t('trace.links.openSession', locale)} · {sessions.find(session => session.id === link.sessionKey)?.title || link.sessionKey}</button>
          <p className="hint mono">{link.reason} · {link.evidenceIds.join(', ') || '—'}</p>
          <button className="btn" type="button" disabled={busy} onClick={() => void readIdentityPage('scan', link.sessionKey)}>{t('trace.links.evidence', locale)}</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void readHistory(link.sessionKey)}>{t('trace.links.history', locale)}</button>
          {link.state !== 'confirmed' && <button className="btn" type="button" disabled={busy} onClick={() => void decide(link.sessionKey, 'confirmed')}>{t('trace.links.confirm', locale)}</button>}
          {link.state !== 'rejected' && <button className="btn" type="button" disabled={busy} onClick={() => void decide(link.sessionKey, 'rejected')}>{t('trace.links.reject', locale)}</button>}
          {link.state !== 'revoked' && <button className="btn" type="button" disabled={busy} onClick={() => void decide(link.sessionKey, 'revoked')}>{t('trace.links.revoke', locale)}</button>}
        </div>
      ))}
      {page?.hasMore && <button className="btn" type="button" disabled={busy} onClick={() => void load(page.nextCursor ?? undefined)}>{t('trace.links.next', locale)}</button>}
      <label>{t('trace.links.choose', locale)}
        <input className="ui-input" aria-label={t('trace.links.choose', locale)} list={'trace-sessions-' + proxyId} value={sessionKey} onChange={event => setSessionKey(event.target.value)} />
      </label>
      <datalist id={'trace-sessions-' + proxyId}>{options.map(session => <option key={session.id} value={session.id}>{session.title || session.id}</option>)}</datalist>
      <label>{t('trace.links.note', locale)}<textarea className="ui-input" aria-label={t('trace.links.note', locale)} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
      <button className="btn" type="button" disabled={busy || sessionKey === ''} onClick={() => void decide(sessionKey, 'confirmed')}>{t('trace.links.confirm', locale)}</button>
      {history !== null && <details open><summary>{t('trace.links.history', locale)} · {history.key}</summary>
        {history.items.map(item => <p key={item.sequence}><LinkState state={item.state} locale={locale} /> <span>{item.decidedAt} · {item.note ?? '—'}</span></p>)}
        {history.hasMore && <button className="btn" type="button" disabled={busy} onClick={() => void readHistory(history.key, history.nextCursor ?? undefined)}>{t('trace.links.next', locale)}</button>}
      </details>}
      <details><summary>{t('trace.links.identities', locale)}</summary>
        {identities !== null && <IdentityList page={identities} locale={locale}
          onFirst={() => void readIdentityPage(identities.source, identities.sourceKey)}
          onNext={() => void readIdentityPage(identities.source, identities.sourceKey, identities.nextCursor ?? undefined)} />}
      </details>
    </section>
  );
}

/** Separate, lazy exploration: scan sources are not rewritten as proxy sessions. */
export function SessionCaptureLinksPanel({ sessionKey, locale, onOpenRequest, onOpenSession, invalidateKey = 0, traceExportEnabled = false }: {
  sessionKey: string; locale: Locale; onOpenRequest: (id: number) => void; onOpenSession?: (key: string) => void; invalidateKey?: number; traceExportEnabled?: boolean;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [traceExportOpen, setTraceExportOpen] = useState(false);
  const [linkedExportOpen, setLinkedExportOpen] = useState(false);
  const [executionOpen, setExecutionOpen] = useState(false);
  const [parentsOpen, setParentsOpen] = useState(false);
  const [page, setPage] = useState<SessionCaptureLinkPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const [busy, setBusy] = useState(false);
  const version = useRef(invalidateKey); const generation = useRef(0);
  useEffect(() => { version.current = invalidateKey; }, [invalidateKey]);
  const load = useCallback(async (cursor?: number) => {
    const token = ++generation.current; const atVersion = version.current;
    setBusy(true); setError(null);
    try {
      const result = await api.sessionCaptureLinks(sessionKey, cursor);
      if (token !== generation.current) return;
      setPage(result); setLoadedVersion(atVersion);
    } catch (error: unknown) { if (token === generation.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (token === generation.current) setBusy(false); }
  }, [sessionKey]);
  useEffect(() => { if (expanded) void load(); return () => { generation.current += 1; }; }, [expanded, load]);
  return <><div className="family-entry"><button className="btn" type="button" disabled={sessionKey === ''} onClick={() => setFamilyOpen(true)}>{locale === 'zh' ? 'Agent 家族与尝试' : 'Agent family & attempts'} →</button><span>{locale === 'zh' ? '父子会话 · 独立网络尝试 · 原始 Trace' : 'Parent & child sessions · independent attempts · original traces'}</span></div>
    <div className="family-entry"><button className="btn" type="button" disabled={sessionKey === ''} onClick={() => setToolsOpen(true)}>{locale === 'zh' ? '工具执行调查台' : 'Tool execution investigation'} →</button><span>{locale === 'zh' ? '原生工具 ID · 输入与输出 · 错误与上下文' : 'Native tool IDs · inputs & outputs · errors & context'}</span></div>
    {traceExportEnabled && <><div className="family-entry"><button className="btn" type="button" aria-expanded={traceExportOpen} onClick={() => setTraceExportOpen(open => !open)}>{locale === 'zh' ? '标准 Trace 导出' : 'Standard Trace export'}</button></div>
      {traceExportOpen && <Suspense fallback={<Skeleton count={1} />}><TraceExportPanel sessionKey={sessionKey} locale={locale} invalidateKey={invalidateKey} /></Suspense>}
      <div className="family-entry"><button className="btn" type="button" aria-expanded={linkedExportOpen} onClick={() => setLinkedExportOpen(open => !open)}>{locale === 'zh' ? '跨来源 Trace 导出' : 'Cross-source Trace export'}</button></div>
      {linkedExportOpen && <Suspense fallback={<Skeleton count={1} />}><LinkedTraceExportPanel sessionKey={sessionKey} locale={locale} invalidateKey={invalidateKey} /></Suspense>}
    </>}
    {toolsOpen && <Suspense fallback={<Skeleton count={1} />}><ToolExecutionPanel sessionKey={sessionKey} locale={locale} invalidateKey={invalidateKey} onClose={() => setToolsOpen(false)} onOpenRequest={onOpenRequest} /></Suspense>}
    {familyOpen && <Suspense fallback={<Skeleton count={1} />}><SessionFamilyPanel sessionKey={sessionKey} locale={locale} invalidateKey={invalidateKey} onClose={() => setFamilyOpen(false)} onOpenSession={onOpenSession} onOpenRequest={onOpenRequest} /></Suspense>}
    <details className="session-findings-panel" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t('trace.links.title', locale)}</summary>
    {expanded && <div>
      <p className="hint">{t('trace.links.hint', locale)}</p>
      <p className="hint">{t('trace.links.promptHint', locale)}</p>
      <button className="btn" type="button" aria-expanded={executionOpen} onClick={() => setExecutionOpen(value => !value)}>{t('trace.execution.title', locale)}</button>
      {executionOpen && <Suspense fallback={<Skeleton count={1} />}><LinkedExecutionPanel sessionKey={sessionKey} locale={locale} onOpenRequest={onOpenRequest} invalidateKey={invalidateKey} /></Suspense>}
      <button className="btn" type="button" aria-expanded={parentsOpen} onClick={() => setParentsOpen(value => !value)}>{t('trace.parents.title', locale)}</button>
      {parentsOpen && <Suspense fallback={<Skeleton count={1} />}><NativeSessionParentsPanel sessionKey={sessionKey} locale={locale} onOpenSession={onOpenSession} invalidateKey={invalidateKey} /></Suspense>}
      {loadedVersion >= 0 && loadedVersion !== invalidateKey && <p role="status">{t('trace.links.stale', locale)}</p>}
      <button className="btn" type="button" disabled={busy} onClick={() => void load()}>{t('trace.links.refresh', locale)}</button>
      {busy && <Skeleton count={2} />}
      {error !== null && <ErrorState code="TRACE_LINKS_FAILED" message={error} onRetry={() => void load()} />}
      {page !== null && <p>{t('trace.links.memberships', locale)}: {page.confirmedCount} · {t('trace.links.candidate', locale)}: {page.candidateCount}</p>}
      {page?.items.length === 0 && <EmptyState icon={<IconSearch />} title={t('trace.links.empty', locale)} />}
      {page !== null && <table className="ui-table ui-table-compact"><tbody>{page.items.map(({ association, request }) => <tr key={association.id}>
        <td><LinkState state={association.state} locale={locale} /></td>
        <td><button className="btn" type="button" onClick={() => onOpenRequest(request.id)}>{request.method} {request.hostname} · #{request.id}</button></td>
        <td>{request.hasSystemPrompt && <button className="btn" type="button" onClick={() => onOpenRequest(request.id)}>{t('trace.links.prompt', locale)} · #{request.id}</button>}</td>
        <td className="mono">{request.model ?? '—'} · {request.responseStatus ?? '—'}</td>
        <td className="hint">{association.reason}</td>
      </tr>)}</tbody></table>}
      {page?.hasMore && <button className="btn" type="button" disabled={busy} onClick={() => void load(page.nextCursor ?? undefined)}>{t('trace.links.next', locale)}</button>}
    </div>}
  </details></>;
}
