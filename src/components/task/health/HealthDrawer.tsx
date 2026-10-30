import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Locale } from '../../../i18n.js';
import type { TaskContext } from '../../../core/task-types.js';
import type { HealthEvidence, HealthReport, HealthScope } from '../../../core/task-health/types.js';
import { ApiError } from '../../../api/client.js';
import { healthLabel } from '../../../core/task-health/format.js';
import { taskApi } from '../task-data.js';
import { healthApi } from './health-client.js';
import type { HealthReportIndexItem } from './health-client.js';
import { healthCopy } from './health-copy.js';
import { HealthReportView } from './HealthReportView.js';

export function HealthDrawer({ context, locale, reportId, from, to, onReport, onClose, onLocate, sourceVersion = 0, evidenceUnavailable = false }: {
  context: TaskContext; locale: Locale; reportId: string; from?: string; to?: string;
  onReport: (id: string) => void; onClose: () => void; onLocate: (evidence: HealthEvidence, recordId: string) => void;
  sourceVersion?: number; evidenceUnavailable?: boolean;
}) {
  const c = healthCopy(locale), taskId = context.task.id;
  const [selection, setSelection] = useState('all'), [prepared, setPrepared] = useState<TaskContext | null>(null);
  const [report, setReport] = useState<HealthReport | null>(null), [history, setHistory] = useState<HealthReportIndexItem[]>([]);
  const [busy, setBusy] = useState(false), [historyBusy, setHistoryBusy] = useState(false), [error, setError] = useState(''), [historyError, setHistoryError] = useState(false), [message, setMessage] = useState<'cancelled' | 'preparing' | 'updated' | ''>('');
  const scope: HealthScope = { member: selection === 'main' ? 'main' : 'all', from: selection === 'window' ? from ?? null : null, to: selection === 'window' ? to ?? null : null };
  const identity = JSON.stringify([taskId, selection, scope.from, scope.to, context.task.updatedAt, sourceVersion]);
  const sourceIdentity = JSON.stringify([taskId, context.task.updatedAt, sourceVersion]);
  const previousSource = useRef(sourceIdentity);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const owner = useRef<AbortController | null>(null), sequence = useRef(0), historyOwner = useRef<AbortController | null>(null);
  const callbacks = useRef({ onReport }); callbacks.current = { onReport };
  const activeReport = useRef(report); activeReport.current = report;
  const cancel = () => { sequence.current++; owner.current?.abort(); setBusy(false); setMessage('cancelled'); setError(''); };
  useLayoutEffect(() => {
    sequence.current++; owner.current?.abort(); activeReport.current = null; setReport(null); setBusy(false); setError(''); setMessage('');
    return () => { sequence.current++; owner.current?.abort(); };
  }, [identity]);
  useEffect(() => { if (previousSource.current !== sourceIdentity) { previousSource.current = sourceIdentity; setHistory(old => old.map(item => ({ ...item, expired: true }))); setMessage('updated'); setPrepared(null); } }, [sourceIdentity]);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    owner.current?.abort(); const controller = new AbortController(), version = ++sequence.current, key = identity; owner.current = controller;
    setBusy(true); setError(''); setMessage('');
    const valid = () => !controller.signal.aborted && sequence.current === version && currentIdentity.current === key;
    const timer = setTimeout(() => { if (valid()) { sequence.current++; controller.abort(); setBusy(false); setError('error'); } }, 50000);
    try { await action(controller.signal); }
    catch (cause) { if (valid()) setError(cause instanceof ApiError && cause.code === 'BUSY' ? 'busy' : 'error'); }
    finally { clearTimeout(timer); if (valid()) setBusy(false); }
  };
  const loadHistory = async () => {
    historyOwner.current?.abort(); const controller = new AbortController(); historyOwner.current = controller; setHistoryBusy(true); setHistoryError(false);
    const timer = setTimeout(() => { if (historyOwner.current === controller) { controller.abort(); setHistoryBusy(false); setHistoryError(true); } }, 10000);
    try { const data = await healthApi.list(taskId, controller.signal); if (!controller.signal.aborted && historyOwner.current === controller) setHistory(data.items); }
    catch { if (!controller.signal.aborted && historyOwner.current === controller) setHistoryError(true); }
    finally { clearTimeout(timer); if (!controller.signal.aborted && historyOwner.current === controller) setHistoryBusy(false); }
  };
  useEffect(() => { setHistory([]); setPrepared(null); void loadHistory(); return () => historyOwner.current?.abort(); }, [taskId]);
  useEffect(() => {
    if (reportId === 'new' || activeReport.current?.id === reportId) return;
    void run(async signal => {
      const value = await healthApi.read(reportId, taskId, signal);
      if (!signal.aborted && currentIdentity.current === identity) setReport(value);
    });
  }, [taskId, reportId]);
  const generate = () => void run(async signal => {
    const value = await healthApi.generate(taskId, scope, signal);
    if (signal.aborted || currentIdentity.current !== identity) return;
    activeReport.current = value; setReport(value); callbacks.current.onReport(value.id);
    setHistory(old => [{ id: value.id, generatedAt: value.generatedAt, mode: 'standard' as const, revision: value.revision, expired: false, reportId: null }, ...old.filter(item => item.id !== value.id)].slice(0, 50));
  });
  const prepare = () => void run(async signal => {
    const page = await taskApi.records(taskId, { member: 'all', offset: 0, limit: 200 }, signal);
    if (signal.aborted || currentIdentity.current !== identity) return;
    setPrepared(page.context); setMessage('preparing');
  });
  const data = prepared ?? context;
  const focusStart = useRef<HTMLButtonElement>(null), drawer = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement; focusStart.current?.focus(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <aside id="task-health-drawer" className="health-drawer" aria-label={c.title} ref={drawer} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header><h2>{c.title} · {context.task.title}</h2><button type="button" className="btn" ref={focusStart} onClick={onClose}>{c.close}</button></header>
    <div className="health-toolbar"><label>{c.scope}<select value={selection} onChange={event => { setSelection(event.target.value); onReport('new'); }}><option value="all">{c.all}</option><option value="main">{c.main}</option><option value="window" disabled={!from || !to}>{c.window}</option></select></label><button type="button" className="btn" disabled={busy} onClick={prepare}>{c.prepare}</button></div>
    <p>{data.task.loadedMemberCount}/{data.task.memberCount} {c.coverage} · {report ? Object.entries(report.coverage.timing).filter(([, n]) => n > 0).map(([key, n]) => `${healthLabel(key, locale)} ${n}`).join(' / ') : c.unknownTiming}</p>
    {data.task.loadedMemberCount < data.task.memberCount && <p role="status">{c.insufficient}</p>}
    <div className="health-toolbar"><button type="button" className="btn" disabled={busy || selection === 'window' && (!from || !to)} onClick={generate}>{c.generate}</button><button type="button" className="btn" disabled title={c.p4}>{c.deep} · {c.p4}</button>{busy && <button type="button" className="btn" onClick={cancel}>{c.cancel}</button>}</div>
    {busy && <p role="status">{c.loading}</p>}{error && <p role="alert">{error === 'busy' ? c.busy : c.error}</p>}{message && <p role="status">{c[message]}</p>}{evidenceUnavailable && <p role="alert">{c.inaccessible}</p>}
    <section><div className="health-toolbar"><h3>{c.history}</h3><button type="button" className="btn" disabled={historyBusy} onClick={() => void loadHistory()}>{c.refresh}</button></div>{historyBusy && <p role="status">{c.loading}</p>}{historyError && <p role="alert">{c.error}</p>}{!historyBusy && !history.length && <p>{c.empty}</p>}<ul>{history.filter(item => item.mode === 'standard').map(item => <li key={item.id}><button type="button" className="btn" aria-current={reportId === item.id ? 'true' : undefined} onClick={() => { if (item.id === reportId) { if (!report && !busy) void run(async signal => { const value = await healthApi.read(item.id, taskId, signal); if (!signal.aborted && currentIdentity.current === identity) setReport(value); }); return; } sequence.current++; owner.current?.abort(); setReport(null); onReport(item.id); }}>{item.generatedAt} · {c.generate}{item.expired ? ` · ${c.updated}` : ''}</button></li>)}</ul></section>
    {report && <HealthReportView report={report} locale={locale} onLocate={onLocate}/>}
  </aside>;
}
