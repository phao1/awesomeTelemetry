import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Locale } from '../../../i18n.js';
import type { TaskContext } from '../../../core/task-types.js';
import type { DeepHealthReport, HealthEvidence, HealthReport, HealthScope } from '../../../core/task-health/types.js';
import { ApiError } from '../../../api/client.js';
import { healthLabel } from '../../../core/task-health/format.js';
import { taskApi } from '../task-data.js';
import { healthApi } from './health-client.js';
import type { HealthDeepPreview, HealthModelStatus, HealthReportIndexItem } from './health-client.js';
import { healthCopy, healthErrorCopy } from './health-copy.js';
import { DeepHealthReportView } from './DeepHealthReportView.js';
import { HealthReportView } from './HealthReportView.js';

export function HealthDrawer({ context, locale, reportId, from, to, onReport, onClose, onLocate, sourceVersion = 0, evidenceUnavailable = false }: {
  context: TaskContext; locale: Locale; reportId: string; from?: string; to?: string;
  onReport: (id: string) => void; onClose: () => void; onLocate: (evidence: HealthEvidence, recordId: string) => void;
  sourceVersion?: number; evidenceUnavailable?: boolean;
}) {
  const c = healthCopy(locale), taskId = context.task.id;
  const [deepReport, setDeepReport] = useState<DeepHealthReport | null>(null), [preview, setPreview] = useState<HealthDeepPreview | null>(null), [model, setModel] = useState<HealthModelStatus | null>(null), [tab, setTab] = useState<'standard' | 'deep'>('standard');
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
  const cancel = () => { sequence.current++; owner.current?.abort(); setBusy(false); setPreview(null); setMessage('cancelled'); setError(''); };
  useLayoutEffect(() => {
    sequence.current++; owner.current?.abort(); activeReport.current = null; setReport(null); setDeepReport(null); setPreview(null); setTab('standard'); setBusy(false); setError(''); setMessage('');
    return () => { sequence.current++; owner.current?.abort(); };
  }, [identity]);
  useEffect(() => { if (previousSource.current !== sourceIdentity) { previousSource.current = sourceIdentity; setHistory(old => old.map(item => ({ ...item, expired: true }))); setMessage('updated'); setPrepared(null); } }, [sourceIdentity]);
  const run = async (action: (signal: AbortSignal) => Promise<void>, timeout = 50000, deepOperation = false) => {
    owner.current?.abort(); const controller = new AbortController(), version = ++sequence.current, key = identity; owner.current = controller;
    setBusy(true); setError(''); setMessage('');
    const valid = () => !controller.signal.aborted && sequence.current === version && currentIdentity.current === key;
    const timer = setTimeout(() => { if (valid()) { sequence.current++; controller.abort(); setBusy(false); setError(healthErrorCopy('HEALTH_TIMEOUT', locale, deepOperation)); } }, timeout);
    try { await action(controller.signal); }
    catch (cause) { if (valid()) setError(healthErrorCopy(cause instanceof ApiError ? cause.code : 'REQUEST_FAILED', locale, deepOperation)); }
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
    setPreview(null); setDeepReport(null); setTab('standard');
    void run(async signal => {
      const value = await healthApi.read(reportId, taskId, signal);
      if (!signal.aborted && currentIdentity.current === identity) setReport(value);
    });
  }, [taskId, reportId]);
  const generate = () => void run(async signal => {
    const value = await healthApi.generate(taskId, scope, signal);
    if (signal.aborted || currentIdentity.current !== identity) return;
    activeReport.current = value; setReport(value); setDeepReport(null); setPreview(null); setTab('standard'); callbacks.current.onReport(value.id);
    setHistory(old => [{ id: value.id, generatedAt: value.generatedAt, mode: 'standard' as const, revision: value.revision, expired: false, reportId: null }, ...old.filter(item => item.id !== value.id)].slice(0, 50));
  });
  const showPreview = () => { if (!report) return; void run(async signal => {
    const status = await healthApi.modelStatus(signal);
    if (signal.aborted) return; setModel(status);
    if (!status.configured) { setError(c.noModel); return; }
    const value = await healthApi.preview(report.id, signal);
    if (!signal.aborted && currentIdentity.current === identity) setPreview(value);
  }, 50000, true); };
  const confirmDeep = () => { if (!report || !preview) return; const parent = report, confirmed = preview; setPreview(null); void run(async signal => {
    const value = await healthApi.deep(parent.id, confirmed.digest, signal);
    if (signal.aborted || currentIdentity.current !== identity) return;
    setDeepReport(value); setTab('deep');
    setHistory(old => [{ id: value.id, generatedAt: value.generatedAt, mode: 'deep' as const, revision: parent.revision, expired: false, reportId: parent.id }, ...old.filter(item => item.id !== value.id)].slice(0, 50));
  }, 125000, true); };
  const readDeep = (id: string) => void run(async signal => {
    const value = await healthApi.readDeep(id, taskId, signal);
    const parent = await healthApi.read(value.reportId, taskId, signal);
    if (signal.aborted || currentIdentity.current !== identity) return;
    setReport(parent); activeReport.current = parent; setDeepReport(value); setTab('deep'); setPreview(null);
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
    <div className="health-toolbar"><button type="button" className="btn" disabled={busy || selection === 'window' && (!from || !to)} onClick={generate}>{c.generate}</button><button type="button" className="btn" disabled={busy || !report} onClick={showPreview}>{c.deep}</button>{busy && <button type="button" className="btn" onClick={cancel}>{c.cancel}</button>}</div>
    {busy && <p role="status">{c.loading}</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{c[message]}</p>}{evidenceUnavailable && <p role="alert">{c.inaccessible}</p>}
    <section><div className="health-toolbar"><h3>{c.history}</h3><button type="button" className="btn" disabled={historyBusy} onClick={() => void loadHistory()}>{c.refresh}</button></div>{historyBusy && <p role="status">{c.loading}</p>}{historyError && <p role="alert">{c.error}</p>}{!historyBusy && !history.length && <p>{c.empty}</p>}<ul>{history.filter(item => item.mode === 'standard').map(item => <li key={item.id}><button type="button" className="btn" aria-current={reportId === item.id ? 'true' : undefined} onClick={() => { if (item.id === reportId) { if (!report && !busy) void run(async signal => { const value = await healthApi.read(item.id, taskId, signal); if (!signal.aborted && currentIdentity.current === identity) setReport(value); }); return; } sequence.current++; owner.current?.abort(); setReport(null); setPreview(null); setDeepReport(null); setTab('standard'); onReport(item.id); }}>{item.generatedAt} · {c.generate}{item.expired ? ` · ${c.updated}` : ''}</button></li>)}</ul></section>
    {preview && <section aria-label={c.preview}><h3>{c.preview}</h3><p>{c.redacted} · {preview.estimate.bytes} bytes · {c.estimatedTokens}: {preview.estimate.inputTokens} / {preview.estimate.outputTokens}</p><p>{c.model}: {model?.provider} / {model?.model}</p><details><summary>{c.evidence}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '20rem', overflow: 'auto' }}>{JSON.stringify(preview.pack, null, 2)}</pre></details><button type="button" className="btn" disabled={busy} onClick={confirmDeep}>{c.confirm}</button><button type="button" className="btn" onClick={() => setPreview(null)}>{c.cancel}</button></section>}
    {history.some(item => item.mode === 'deep') && <ul>{history.filter(item => item.mode === 'deep').map(item => <li key={item.id}><button className="btn" type="button" disabled={busy} onClick={() => readDeep(item.id)}>{item.generatedAt} · {c.deepTab}{item.expired ? ` · ${c.updated}` : ''}</button></li>)}</ul>}
    {report && <div role="tablist" aria-label={c.title}><button type="button" role="tab" aria-selected={tab === 'standard'} onClick={() => setTab('standard')}>{c.standardTab}</button><button type="button" role="tab" disabled={!deepReport} aria-selected={tab === 'deep'} onClick={() => setTab('deep')}>{c.deepTab}</button></div>}
    {report && tab === 'standard' && <div role="tabpanel"><HealthReportView report={report} locale={locale} onLocate={onLocate}/></div>}
    {deepReport && tab === 'deep' && <div role="tabpanel"><DeepHealthReportView report={deepReport} locale={locale}/></div>}
  </aside>;
}
