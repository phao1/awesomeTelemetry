import { useEffect, useRef, useState } from 'react';
import type { MonitorAgent, MonitorCaptureSelfTest, MonitorConnectionDiagnostics, MonitorConnectionPlan, MonitorConnectionProfile, MonitorConnectionSettings, ProxyRuntimeStatus } from '../core/trace-types.js';
import { api, ApiError } from '../api/client.js';
import { t, type Locale } from '../i18n.js';

interface Props { locale: Locale; onStatus?: (status: ProxyRuntimeStatus) => void; runtimeStatus?: ProxyRuntimeStatus | null; initialAgent?: MonitorAgent; onOpenCapture?: (id: number) => void }
const initial = (agent: MonitorAgent = 'claude'): MonitorConnectionSettings => ({ label: '', agent, projectDirectory: '', executable: null, proxyPort: 7779, noProxy: agent === 'opencode' ? 'localhost,127.0.0.1,::1' : null });
const agents: MonitorAgent[] = ['claude', 'codex', 'opencode'];

function runtimeKey(status: ProxyRuntimeStatus): string {
  const evidence = status.diagnostics;
  // SSE reconstructs object order and can estimate startedAt locally. Neither
  // changes connection evidence. Compare explicit values, not object JSON order.
  return JSON.stringify([status.running, status.starting, status.port, status.requestCount,
    evidence?.phase, evidence?.runId, evidence?.listening, evidence?.cleanupPending,
    evidence?.observedRequests, evidence?.activeRequests, evidence?.pendingWrites,
    evidence?.persistedRequests, evidence?.interruptedRequests, evidence?.captureErrors,
    evidence?.lastRequestAt, evidence?.lastError]);
}

/** Recipe editor only; no browser/API action starts an external Agent process. */
export function MonitorSetupPanel({ locale, onStatus, runtimeStatus, initialAgent, onOpenCapture }: Props) {
  const [profiles, setProfiles] = useState<MonitorConnectionProfile[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [settings, setSettings] = useState(() => initial(initialAgent));
  const [plan, setPlan] = useState<MonitorConnectionPlan | null>(null);
  const [diagnostics, setDiagnostics] = useState<MonitorConnectionDiagnostics | null>(null);
  const [selfTest, setSelfTest] = useState<MonitorCaptureSelfTest | null>(null);
  const selfTestAbort = useRef<AbortController | null>(null);
  const selfTestGeneration = useRef(0);
  const clearSelfTest = (): void => { selfTestGeneration.current += 1; selfTestAbort.current?.abort(); setSelfTest(null); };
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [shell, setShell] = useState<'posix' | 'powershell'>('posix');
  const alive = useRef(true);
  const pendingRef = useRef(false);
  const loadGeneration = useRef(0);
  const diagnosticAbort = useRef<AbortController | null>(null);
  const selected = profiles?.find(profile => profile.id === selectedId);
  const fail = (error: unknown): void => setError({ code: error instanceof ApiError ? error.code : 'MONITOR_SETUP_FAILED', message: error instanceof Error ? error.message : String(error) });
  useEffect(() => {
    alive.current = true;
    const generation = ++loadGeneration.current;
    void api.monitorProfiles().then(response => { if (alive.current && generation === loadGeneration.current) setProfiles(response.items); }).catch(error => { if (alive.current && generation === loadGeneration.current) fail(error); });
    return () => { alive.current = false; loadGeneration.current += 1; diagnosticAbort.current?.abort(); selfTestGeneration.current += 1; selfTestAbort.current?.abort(); };
  }, []);

  const choose = (id: string): void => {
    clearSelfTest();
    const profile = profiles?.find(item => item.id === id);
    setSelectedId(id); setPlan(null); setDiagnostics(null); setCopied(false); setConfirmDelete(false); setError(null);
    setSettings(profile === undefined ? initial(initialAgent) : { label: profile.label, agent: profile.agent, projectDirectory: profile.projectDirectory, executable: profile.executable, proxyPort: profile.proxyPort, noProxy: profile.noProxy });
  };
  const change = (patch: Partial<MonitorConnectionSettings>): void => { clearSelfTest(); setSettings(previous => ({ ...previous, ...patch })); setPlan(null); setDiagnostics(null); setCopied(false); };
  const action = async (work: () => Promise<void>): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true); setError(null); setCopied(false);
    try { await work(); }
    catch (error) { if (alive.current) fail(error); }
    finally { pendingRef.current = false; if (alive.current) setPending(false); }
  };
  const save = (): Promise<void> => action(async () => {
    clearSelfTest();
    const profile = selected === undefined ? await api.monitorCreateProfile(settings) : await api.monitorUpdateProfile(selected.id, settings, selected.revision);
    if (!alive.current) return;
    setProfiles(previous => [...(previous ?? []).filter(item => item.id !== profile.id), profile]);
    setSelectedId(profile.id); setPlan(null); setDiagnostics(null);
  });
  const getPlan = (start: boolean): Promise<void> => action(async () => {
    clearSelfTest();
    if (selected === undefined) return;
    setPlan(null); setDiagnostics(null);
    const next = start ? await api.monitorStartProfile(selected.id, selected.revision) : await api.monitorConnectionPlan(selected.id);
    if (!alive.current) return;
    if (next.profile.revision !== selected.revision) throw new ApiError('MONITOR_PROFILE_CONFLICT', 'Profile changed; reload it before using the command');
    setPlan(next);
    if (start) onStatus?.(next.status);
  });
  const diagnose = (): Promise<void> => action(async () => {
    if (selected === undefined) return;
    setDiagnostics(null);
    const controller = new AbortController(); diagnosticAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const report = await api.monitorConnectionDiagnostics(selected.id, controller.signal);
      if (!alive.current) return;
      if (report.profileRevision !== selected.revision) throw new ApiError('MONITOR_PROFILE_CONFLICT', 'Saved recipe changed; reload before checking this profile');
      setDiagnostics(report);
    } catch (error) {
      if (controller.signal.aborted) throw new ApiError('MONITOR_DIAGNOSTICS_TIMEOUT', 'Diagnostic check did not finish; check the local Web server and retry. No Agent was launched.');
      throw error;
    } finally { clearTimeout(timer); if (diagnosticAbort.current === controller) diagnosticAbort.current = null; }
  });
  const testCapture = (): Promise<void> => action(async () => {
    if (selected === undefined) return;
    clearSelfTest(); const generation = selfTestGeneration.current;
    const controller = new AbortController(); selfTestAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const report = await api.monitorCaptureSelfTest(selected.id, selected.revision, controller.signal);
      if (!alive.current || generation !== selfTestGeneration.current) return;
      if (report.profileId !== selected.id || report.profileRevision !== selected.revision) throw new ApiError('MONITOR_PROFILE_CONFLICT', 'Saved recipe changed; reload before testing');
      setSelfTest(report);
    } catch (error) {
      if (generation !== selfTestGeneration.current || !alive.current) return;
      if (controller.signal.aborted) throw new ApiError('MONITOR_SELF_TEST_FAILED', 'Self-test timed out. A synthetic capture may still be saved; inspect the capture list before retrying.');
      throw error;
    } finally { clearTimeout(timer); if (selfTestAbort.current === controller) selfTestAbort.current = null; }
  });
  const remove = (): Promise<void> => action(async () => {
    clearSelfTest();
    if (selected === undefined) return;
    await api.monitorDeleteProfile(selected.id, selected.revision);
    if (!alive.current) return;
    setProfiles(previous => previous?.filter(item => item.id !== selected.id) ?? []);
    setSelectedId(''); setSettings(initial(initialAgent)); setPlan(null); setDiagnostics(null); setConfirmDelete(false);
  });
  const dirty = selected !== undefined && (Object.keys(initial()) as Array<keyof MonitorConnectionSettings>).some(key => settings[key] !== selected[key]);
  const disabled = pending || profiles === null;
  const stale = diagnostics !== null && runtimeStatus != null && runtimeKey(diagnostics.status) !== runtimeKey(runtimeStatus);
  const errorKeys = { MONITOR_SELF_TEST_NOT_READY: 'monitor.selfTest.notReady', MONITOR_SELF_TEST_BUSY: 'monitor.selfTest.busy', MONITOR_SELF_TEST_FAILED: 'monitor.selfTest.error', MONITOR_PROFILE_CONFLICT: 'monitor.error.conflict', MONITOR_PROFILE_BUSY: 'monitor.error.busy', MONITOR_PROFILE_INVALID: 'monitor.error.invalid', MONITOR_PROFILE_NOT_FOUND: 'monitor.error.missing', MONITOR_NOT_READY: 'monitor.error.notReady', PROXY_ALREADY_RUNNING: 'monitor.error.proxyOwned', MONITOR_DIAGNOSTICS_TIMEOUT: 'monitor.error.diagTimeout' } as const;
  return (
    <section className="monitor-setup" aria-label={t('monitor.title', locale)} style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <p className="hint">{t('monitor.scope', locale)}</p><p className="hint">{t('monitor.stopWarning', locale)}</p>
      <p className="hint">{t('monitor.trustScope', locale)}</p>
      {error !== null && <div role="alert"><strong>{error.code}</strong> — {t(errorKeys[error.code as keyof typeof errorKeys] ?? 'monitor.error.generic', locale)}<p>{error.message}</p></div>}
      {profiles === null && error === null && <p role="status">{t('common.loading', locale)}</p>}
      <button type="button" className="btn" disabled={pending} onClick={() => void action(async () => {
        clearSelfTest();
        const response = await api.monitorProfiles();
        if (alive.current) { setProfiles(response.items); setSelectedId(''); setSettings(initial(initialAgent)); setPlan(null); setDiagnostics(null); }
      })}>{t('monitor.reload', locale)}</button>
      <label>{t('monitor.savedProfiles', locale)}<select className="ui-select" value={selectedId} disabled={disabled} onChange={event => choose(event.target.value)}><option value="">{t('monitor.newProfile', locale)}</option>{profiles?.map(profile => <option key={profile.id} value={profile.id}>{profile.label} · {profile.agent}</option>)}</select></label>
      <form onSubmit={event => { event.preventDefault(); void save(); }} style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <fieldset disabled={disabled} style={{ display: 'grid', gap: 'var(--space-2)', border: 0, padding: 0 }}>
          <label>{t('monitor.label', locale)}<input className="ui-input" value={settings.label} maxLength={80} required onChange={event => change({ label: event.target.value })} /></label>
          <label>{t('monitor.agent', locale)}<select className="ui-select" value={settings.agent} onChange={event => { const agent = event.target.value as MonitorAgent; change({ agent, ...(agent === 'opencode' && settings.noProxy === null ? { noProxy: 'localhost,127.0.0.1,::1' } : {}) }); }}>{agents.map(agent => <option key={agent} value={agent}>{agent}</option>)}</select></label>
          <label>{t('monitor.project', locale)}<input className="ui-input" value={settings.projectDirectory} maxLength={4096} required placeholder="/absolute/project/path" onChange={event => change({ projectDirectory: event.target.value })} /></label>
          <label>{t('monitor.executable', locale)}<input className="ui-input" value={settings.executable ?? ''} maxLength={4096} placeholder={settings.agent} onChange={event => change({ executable: event.target.value === '' ? null : event.target.value })} /></label>
          <label>{t('monitor.port', locale)}<input className="ui-input" type="number" min={1} max={65535} required value={settings.proxyPort} onChange={event => change({ proxyPort: Number(event.target.value) })} /></label>
          <label className="monitor-bypass"><input type="checkbox" checked={settings.noProxy === null} onChange={event => change({ noProxy: event.target.checked ? null : '' })} />{t('monitor.inheritBypass', locale)}</label>
          {settings.noProxy !== null && <label>{t('monitor.noProxy', locale)}<input className="ui-input" value={settings.noProxy} maxLength={2048} onChange={event => change({ noProxy: event.target.value })} /></label>}
          <p className="hint">{t('monitor.bypassWarning', locale)}</p>
          {settings.agent !== 'claude' && <p className="hint">{t(settings.agent === 'opencode' ? 'monitor.openCodeBypass' : 'monitor.codexStandalone', locale)}</p>}
          <button type="submit" className="btn">{t('monitor.save', locale)}</button>
        </fieldset>
      </form>
      {selected !== undefined && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <button type="button" className="btn" disabled={disabled || dirty} onClick={() => void getPlan(false)}>{t('monitor.command', locale)}</button>
        <button type="button" className="btn" disabled={disabled || dirty} onClick={() => void getPlan(true)}>{t('monitor.startListener', locale)}</button>
        <button type="button" className="btn" disabled={disabled || dirty} onClick={() => void diagnose()}>{t('monitor.diagnose', locale)}</button>
        <button type="button" className="btn" disabled={disabled || dirty} onClick={() => void testCapture()}>{t('monitor.selfTest', locale)}</button>
        <button type="button" className="btn" disabled={disabled} onClick={() => setConfirmDelete(true)}>{t('monitor.delete', locale)}</button>
        {dirty && <span className="hint">{t('monitor.saveFirst', locale)}</span>}
      </div>}
      {confirmDelete && <div role="alert"><p>{t('monitor.confirmDelete', locale)}</p><button type="button" className="btn" disabled={pending} onClick={() => void remove()}>{t('common.confirm', locale)}</button><button type="button" className="btn" disabled={pending} onClick={() => setConfirmDelete(false)}>{t('common.cancel', locale)}</button></div>}
      {pending && <p role="status">{t('monitor.working', locale)}</p>}
      {selected !== undefined && <p className="hint">{t('monitor.selfTestScope', locale)}</p>}
      {selfTest !== null && <section aria-label={t('monitor.selfTestTitle', locale)}>
        <h3>{t('monitor.selfTestTitle', locale)}</h3>
        <p role="status">{t(selfTest.passed ? 'monitor.selfTestPassed' : 'monitor.selfTestFailed', locale)}</p>
        <p className="hint"><time dateTime={selfTest.checkedAt}>{selfTest.checkedAt}</time> · {t('monitor.selfTestScope', locale)}</p>
        {runtimeStatus != null && (!runtimeStatus.running || runtimeStatus.port !== selected?.proxyPort || runtimeStatus.diagnostics?.runId !== selfTest.runId) && <p role="status">{t('monitor.snapshotStale', locale)}</p>}
        <ul>{(['forwarding', 'persistence', 'originals', 'parsing'] as const).map(check => <li key={check}>{t(`monitor.selfTest.${check}`, locale)}: {t(selfTest.checks[check] ? 'monitor.selfTest.ok' : 'monitor.selfTest.notOk', locale)}</li>)}</ul>
        <p>{t('monitor.selfTestUnverified', locale)}</p>
        {onOpenCapture !== undefined && <button type="button" className="btn" onClick={() => onOpenCapture(selfTest.proxyId)}>{t('monitor.selfTestOpen', locale)} #{selfTest.proxyId}</button>}
      </section>}
      {diagnostics !== null && <section aria-label={t('monitor.diagnosticTitle', locale)}>
        <h3>{t('monitor.diagnosticTitle', locale)}</h3>
        <p className="hint">{t('monitor.snapshot', locale)} <time dateTime={diagnostics.checkedAt}>{diagnostics.checkedAt}</time></p>
        {stale && <p role="status">{t('monitor.snapshotStale', locale)}</p>}
        <p>{t('monitor.listener', locale)}: {t(`monitor.listener.${diagnostics.listener}`, locale)} · {t('monitor.expectedPort', locale)} {diagnostics.expectedPort} / {t('monitor.actualPort', locale)} {diagnostics.status.port ?? '—'}</p>
        <p>{t('monitor.publicCa', locale)}: {t(`monitor.ca.${diagnostics.ca.state}`, locale)} · {t('monitor.validUntil', locale)} {diagnostics.ca.validUntil ?? '—'}</p>
        {diagnostics.ca.sha256 !== null && <p className="mono" style={{ overflowWrap: 'anywhere' }}>CA SHA-256: {diagnostics.ca.sha256}</p>}
        <p>{t('monitor.runtimeTrust', locale)}: {diagnostics.trust.variable}</p>
        <p>{t('monitor.sharedTraffic', locale)}: {t(`monitor.traffic.${diagnostics.traffic.state}`, locale)} · {t('monitor.observed', locale)} {diagnostics.status.diagnostics?.observedRequests ?? '—'}</p>
        {diagnostics.status.diagnostics?.lastError != null && <p>{t('monitor.lastError', locale)}: <code>{diagnostics.status.diagnostics.lastError}</code></p>}
        <ul>{diagnostics.issues.map(issue => <li key={issue.code}><span>[{t(`monitor.severity.${issue.severity}`, locale)}] </span><code>{issue.code}</code><p>{t(`monitor.check.${issue.code}`, locale)}</p></li>)}</ul>
      </section>}
      {plan !== null && <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <p>{t('monitor.runExplicitly', locale)}</p>
        <label>{t('monitor.shell', locale)}<select className="ui-select" value={shell} onChange={event => { setShell(event.target.value as typeof shell); setCopied(false); }}><option value="posix">POSIX (macOS / Linux)</option><option value="powershell">PowerShell</option></select></label>
        <textarea aria-label={t('monitor.launchCommand', locale)} className="ui-input mono" readOnly rows={5} value={plan.commands[shell]} />
        <button type="button" className="btn" onClick={() => void action(async () => { await navigator.clipboard.writeText(plan.commands[shell]); if (alive.current) setCopied(true); })}>{t(copied ? 'monitor.copied' : 'monitor.copy', locale)}</button>
        <p className="hint">{t('monitor.unverified', locale)}</p><p className="mono" style={{ overflowWrap: 'anywhere' }}>CA SHA-256: {plan.caSha256}</p>
      </div>}
    </section>
  );
}
