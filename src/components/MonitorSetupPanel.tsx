import { useCallback, useEffect, useRef, useState } from 'react';
import type { MonitorAgent, MonitorCaptureSelfTest, MonitorConnectionDiagnostics, MonitorConnectionPlan, MonitorConnectionProfile, MonitorConnectionSettings, ProxyRuntimeStatus } from '../core/trace-types.js';
import { api, ApiError } from '../api/client.js';
import { t, type Locale } from '../i18n.js';
import { Modal } from './ui/Modal.js';
import { Skeleton } from './ui/States.js';

interface Props {
  locale: Locale; onStatus?: (status: ProxyRuntimeStatus) => void; runtimeStatus?: ProxyRuntimeStatus | null;
  initialAgent?: MonitorAgent; onOpenCapture?: (id: number) => void;
  onRuntimeUncertain?: () => void; listenerBlocked?: boolean;
  onInteractionState?: (state: { dirty: boolean; pending: boolean; affectsRuntime: boolean }) => void;
}
const initial = (agent: MonitorAgent = 'claude'): MonitorConnectionSettings => ({ label: '', agent, projectDirectory: '', executable: null, proxyPort: 7779, noProxy: agent === 'opencode' ? 'localhost,127.0.0.1,::1' : null });
const agents: MonitorAgent[] = ['claude', 'codex', 'opencode'];
const settingsOf = (profile: MonitorConnectionSettings): MonitorConnectionSettings => ({ label: profile.label, agent: profile.agent,
  projectDirectory: profile.projectDirectory, executable: profile.executable, proxyPort: profile.proxyPort, noProxy: profile.noProxy });
const sameSettings = (left: MonitorConnectionSettings, right: MonitorConnectionSettings): boolean =>
  (Object.keys(initial()) as Array<keyof MonitorConnectionSettings>).every(key => left[key] === right[key]);
const validStatus = (value: ProxyRuntimeStatus): boolean => value != null && typeof value.running === 'boolean' && typeof value.starting === 'boolean'
  && (value.port === null || Number.isInteger(value.port)) && Number.isFinite(value.requestCount) && (value.startedAt === null || typeof value.startedAt === 'string');
const validProfile = (value: MonitorConnectionProfile): boolean => value != null && typeof value.id === 'string' && value.id !== '' && Number.isInteger(value.revision) && value.revision > 0
  && typeof value.label === 'string' && agents.includes(value.agent) && typeof value.projectDirectory === 'string' && Number.isInteger(value.proxyPort) && value.proxyPort >= 1 && value.proxyPort <= 65535
  && (value.executable === null || typeof value.executable === 'string') && (value.noProxy === null || typeof value.noProxy === 'string') && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
type Kind = 'profiles' | 'save' | 'delete' | 'plan' | 'start' | 'diagnose' | 'selfTest' | 'status' | 'copy';
interface Operation { kind: Kind; controller: AbortController; timer: ReturnType<typeof setTimeout>; cancel: () => void }
const mutation = (kind: Kind): boolean => ['save', 'delete', 'start', 'selfTest'].includes(kind);
const timeoutCode = (kind: Kind): string => kind === 'diagnose' ? 'MONITOR_DIAGNOSTICS_TIMEOUT' : kind === 'selfTest' ? 'MONITOR_SELF_TEST_FAILED' : 'MONITOR_' + kind.toUpperCase() + '_TIMEOUT';

function runtimeKey(status: ProxyRuntimeStatus): string {
  const evidence = status.diagnostics;
  // Object order and legacy start timestamps do not change connection evidence.
  return JSON.stringify([status.running, status.starting, status.port, status.requestCount,
    evidence?.phase, evidence?.runId, evidence?.listening, evidence?.cleanupPending,
    evidence?.observedRequests, evidence?.activeRequests, evidence?.pendingWrites,
    evidence?.persistedRequests, evidence?.interruptedRequests, evidence?.captureErrors,
    evidence?.lastRequestAt, evidence?.lastError]);
}

/** Recipe editor only; no browser/API action starts an external Agent process. */
export function MonitorSetupPanel({ locale, onStatus, runtimeStatus, initialAgent, onOpenCapture, onRuntimeUncertain, listenerBlocked = false, onInteractionState }: Props) {
  const [profiles, setProfiles] = useState<MonitorConnectionProfile[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [settings, setSettings] = useState(() => initial(initialAgent));
  const [portDraft, setPortDraft] = useState('7779');
  const newBaseline = useRef(initial(initialAgent));
  const [baseline, setBaseline] = useState<MonitorConnectionProfile | null>(null);
  const [plan, setPlan] = useState<MonitorConnectionPlan | null>(null);
  const [diagnostics, setDiagnostics] = useState<MonitorConnectionDiagnostics | null>(null);
  const [selfTest, setSelfTest] = useState<MonitorCaptureSelfTest | null>(null);
  const [busy, setBusy] = useState<Kind | null>('profiles');
  const owner = useRef<Operation | null>(null);
  const [unknown, setUnknown] = useState({ profile: false, runtime: false, selfTest: false });
  const unknownNow = useRef(unknown);
  const [listIssue, setListIssue] = useState(false), listIssueNow = useRef(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [shell, setShell] = useState<'posix' | 'powershell'>('posix');
  const callbacks = useRef({ onStatus, onRuntimeUncertain });
  useEffect(() => { callbacks.current = { onStatus, onRuntimeUncertain }; }, [onStatus, onRuntimeUncertain]);
  const setRisk = useCallback((patch: Partial<typeof unknown>) => {
    unknownNow.current = { ...unknownNow.current, ...patch };setUnknown(unknownNow.current);
  }, []);
  const invalidate = useCallback(() => { setPlan(null);setDiagnostics(null);setSelfTest(null);setCopied(false);setSaved(false); }, []);
  const markRisk = useCallback((kind: Kind) => {
    if (kind === 'save' || kind === 'delete') setRisk({ profile: true });
    if (kind === 'start') { setRisk({ runtime: true });callbacks.current.onRuntimeUncertain?.(); }
    if (kind === 'selfTest') setRisk({ selfTest: true });
  }, [setRisk]);
  const run = useCallback(<T,>(kind: Kind, read: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void): void => {
    if (owner.current !== null) return;
    setBusy(kind);setError(null);setCopied(false);setSaved(false);
    const controller = new AbortController();
    const fail = (code: string, message: string): void => {
      setError({ code, message });
      if (kind === 'profiles') { listIssueNow.current = true;setListIssue(true); }
    };
    const release = (): void => { clearTimeout(active.timer);if (owner.current === active) { owner.current = null;setBusy(null); } };
    const active: Operation = { kind, controller, timer: setTimeout(() => {
      if (owner.current !== active) return;
      release();controller.abort();markRisk(kind);console.error('[monitor] operation deadline:', kind);
      fail(timeoutCode(kind), 'Local wait deadline exceeded; the backend operation was not rolled back.');
    }, kind === 'start' || kind === 'selfTest' ? 12000 : kind === 'save' || kind === 'delete' ? 10000 : 5000), cancel: () => {
      if (owner.current !== active) return;
      release();controller.abort();markRisk(kind);fail('MONITOR_WAIT_CANCELLED', 'Only local waiting was cancelled.');
    } };
    owner.current = active;
    void (async () => read(controller.signal))().then(value => { if (owner.current === active) accept(value); }).catch((cause: unknown) => {
      if (owner.current !== active) return;
      console.error('[monitor] operation failed:', kind, cause);
      // Definite4xx rejection is distinct from an interrupted/uncertain write.
      if (mutation(kind) && !(cause instanceof ApiError && cause.status !== undefined && cause.status >= 400 && cause.status < 500)) markRisk(kind);
      if (cause instanceof ApiError && cause.code === 'MONITOR_PROFILE_CONFLICT' && kind !== 'diagnose' && kind !== 'selfTest') { listIssueNow.current = true;setListIssue(true); }
      fail(cause instanceof ApiError ? cause.code : 'MONITOR_SETUP_FAILED', cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (owner.current === active) release(); });
  }, [markRisk]);
  const readProfiles = useCallback(() => {
    invalidate();
    run('profiles', signal => api.monitorProfiles(signal), value => {
      if (value == null || !Array.isArray(value.items) || value.items.length > 32 || !value.items.every(validProfile)) throw new Error('Invalid profile list response');
      setProfiles(value.items);listIssueNow.current = false;setListIssue(false);setRisk({ profile: false });
    });
  }, [run, invalidate, setRisk]);
  useEffect(() => {
    readProfiles();
    return () => {
      const active = owner.current;owner.current = null;
      if (active !== null) { clearTimeout(active.timer);active.controller.abort();if (active.kind === 'start') callbacks.current.onRuntimeUncertain?.(); }
    };
  }, [readProfiles]);
  const selected = baseline ?? undefined;
  const currentSaved = profiles?.find(profile => profile.id === selectedId);
  const changedRevision = baseline !== null && profiles !== null && (currentSaved === undefined || baseline.revision !== currentSaved.revision || !sameSettings(baseline, currentSaved));
  const dirty = !sameSettings(settings, baseline ?? newBaseline.current);
  const pending = busy !== null, disabled = pending || profiles === null || switchTo !== null;
  useEffect(() => { onInteractionState?.({ dirty, pending, affectsRuntime: busy === 'start' }); }, [onInteractionState, dirty, pending, busy]);
  const choose = (id: string): void => {
    const profile = profiles?.find(item => item.id === id) ?? null;
    const next = profile === null ? initial(initialAgent) : settingsOf(profile);
    if (profile === null) newBaseline.current = next;
    setBaseline(profile);setSelectedId(profile?.id ?? '');setSettings(next);setPortDraft(String(next.proxyPort));invalidate();setConfirmDelete(false);setError(null);
  };
  const requestChoose = (id: string): void => { if (owner.current !== null) return;if (dirty) setSwitchTo(id);else choose(id); };
  const change = (patch: Partial<MonitorConnectionSettings>): void => { if (owner.current !== null) return;invalidate();setSettings(previous => ({ ...previous, ...patch })); };
  const ready = (): boolean => owner.current === null && profiles !== null && !listIssueNow.current && !unknownNow.current.profile && !changedRevision;
  const save = (): void => {
    if (!ready()) return;
    if (settings.label.trim() === '' || settings.projectDirectory.trim() === '' || !Number.isInteger(settings.proxyPort) || settings.proxyPort < 1 || settings.proxyPort > 65535) {
      setError({ code: 'MONITOR_PROFILE_INVALID', message: 'Name, absolute project path and an integer port (1..65535) are required.' });return;
    }
    invalidate();
    run('save', signal => selected === undefined ? api.monitorCreateProfile(settings, signal) : api.monitorUpdateProfile(selected.id, settings, selected.revision, signal), profile => {
      if (!validProfile(profile) || selected !== undefined && (profile.id !== selected.id || profile.revision <= selected.revision)) throw new Error('Invalid saved profile response');
      setProfiles(previous => [...(previous ?? []).filter(item => item.id !== profile.id), profile]);setBaseline(profile);setSelectedId(profile.id);setSettings(settingsOf(profile));setPortDraft(String(profile.proxyPort));setSaved(true);
    });
  };
  const getPlan = (start: boolean): void => {
    if (!ready() || selected === undefined || dirty || start && (listenerBlocked || unknownNow.current.runtime)) return;
    invalidate();
    run(start ? 'start' : 'plan', signal => start ? api.monitorStartProfile(selected.id, selected.revision, signal) : api.monitorConnectionPlan(selected.id, signal), next => {
      if (next == null || next.profile?.id !== selected.id || next.profile.revision !== selected.revision || !sameSettings(next.profile, selected)) throw new ApiError('MONITOR_PROFILE_CONFLICT', 'Saved recipe changed; reload and review it.');
      if (!validStatus(next.status) || typeof next.commands?.posix !== 'string' || typeof next.commands?.powershell !== 'string' || typeof next.caSha256 !== 'string') throw new Error('Invalid connection plan response');
      if (start && (!next.status.running || next.status.port !== selected.proxyPort)) throw new ApiError('MONITOR_NOT_READY', 'Listener readiness was not confirmed for the selected port.');
      setPlan(next);if (start) callbacks.current.onStatus?.(next.status);
    });
  };
  const diagnose = (): void => {
    if (!ready() || selected === undefined || dirty) return;
    setDiagnostics(null);
    run('diagnose', signal => api.monitorConnectionDiagnostics(selected.id, signal), report => {
      if (report == null || report.profileId !== selected.id || report.profileRevision !== selected.revision) throw new ApiError('MONITOR_PROFILE_CONFLICT', 'Saved recipe changed; reload and review it.');
      if (!validStatus(report.status) || report.ca == null || report.trust == null || report.traffic == null || !Array.isArray(report.issues)) throw new Error('Invalid diagnostic response');
      setDiagnostics(report);
    });
  };
  const refreshStatus = (): void => run('status', signal => api.proxyStatus(signal), status => {
    if (!validStatus(status)) throw new Error('Invalid runtime status response');
    setRisk({ runtime: false, selfTest: false });callbacks.current.onStatus?.(status);
  });
  const lastRuntime = useRef(runtimeStatus);
  useEffect(() => {
    const changed = lastRuntime.current !== runtimeStatus;lastRuntime.current = runtimeStatus;
    if (changed && runtimeStatus != null && validStatus(runtimeStatus) && owner.current?.kind !== 'start') setRisk({ runtime: false });
  }, [runtimeStatus, setRisk]);
  const testCapture = (): void => {
    if (!ready() || selected === undefined || dirty || listenerBlocked || unknownNow.current.runtime || unknownNow.current.selfTest) return;
    setSelfTest(null);
    run('selfTest', signal => api.monitorCaptureSelfTest(selected.id, selected.revision, signal), report => {
      if (report == null || report.profileId !== selected.id || report.profileRevision !== selected.revision) throw new ApiError('MONITOR_PROFILE_CONFLICT', 'Saved recipe changed; reload and review it.');
      if (report.checks == null || !['forwarding', 'persistence', 'originals', 'parsing'].every(key => typeof report.checks[key as keyof typeof report.checks] === 'boolean') || !Number.isInteger(report.proxyId) || typeof report.passed !== 'boolean') throw new Error('Invalid self-test response');
      if (report.scope !== 'local_http_sse' || report.synthetic !== true || report.agentVerified !== false || report.tlsVerified !== false || report.passed && !Object.values(report.checks).every(Boolean)) throw new Error('Contradictory synthetic self-test evidence');
      setSelfTest(report);
    });
  };
  const remove = (): void => {
    if (!ready() || selected === undefined) return;
    setConfirmDelete(false);invalidate();
    run('delete', signal => api.monitorDeleteProfile(selected.id, selected.revision, signal), value => {
      if (value?.deleted !== true) throw new Error('Unconfirmed recipe deletion');
      setProfiles(previous => previous?.filter(item => item.id !== selected.id) ?? []);choose('');
    });
  };
  const profileBlocked = disabled || listIssue || unknown.profile || changedRevision;
  const stale = diagnostics !== null && runtimeStatus != null && runtimeKey(diagnostics.status) !== runtimeKey(runtimeStatus);
  const errorKeys = { MONITOR_SELF_TEST_NOT_READY: 'monitor.selfTest.notReady', MONITOR_SELF_TEST_BUSY: 'monitor.selfTest.busy', MONITOR_SELF_TEST_FAILED: 'monitor.selfTest.error', MONITOR_PROFILE_CONFLICT: 'monitor.error.conflict', MONITOR_PROFILE_BUSY: 'monitor.error.busy', MONITOR_PROFILE_INVALID: 'monitor.error.invalid', MONITOR_PROFILE_NOT_FOUND: 'monitor.error.missing', MONITOR_NOT_READY: 'monitor.error.notReady', PROXY_ALREADY_RUNNING: 'monitor.error.proxyOwned', MONITOR_DIAGNOSTICS_TIMEOUT: 'monitor.error.diagTimeout' } as const;
  return (
    <section className="monitor-setup" aria-label={t('monitor.title', locale)}>
      <p className="hint">{t('monitor.flow.scope', locale)}</p>
      <details className="monitor-boundaries"><summary>{t('monitor.flow.boundaries', locale)}</summary>
        <p className="hint">{t('monitor.scope', locale)}</p><p className="hint">{t('monitor.stopWarning', locale)}</p><p className="hint">{t('monitor.trustScope', locale)}</p>
      </details>
      {error !== null && <div className="ui-error" role="alert"><strong>{error.code}</strong> — {t(error.code === 'MONITOR_WAIT_CANCELLED' ? 'monitor.flow.cancelled'
        : error.code.endsWith('_TIMEOUT') && error.code !== 'MONITOR_DIAGNOSTICS_TIMEOUT' ? 'monitor.flow.timeout' : errorKeys[error.code as keyof typeof errorKeys] ?? 'monitor.error.generic', locale)}<p>{error.message}</p></div>}
      {unknown.profile && <p role="alert">{t('monitor.flow.profileUncertain', locale)}</p>}
      {unknown.runtime && <p role="alert">{t('monitor.flow.runtimeUncertain', locale)}</p>}
      {unknown.selfTest && <p role="alert">{t('monitor.flow.testUncertain', locale)}</p>}
      {busy !== null && <div className="capture-toolbar" role="status"><span>{t('monitor.working', locale)} · {t('monitor.flow.' + busy as Parameters<typeof t>[0], locale)}</span>
        <button type="button" className="btn" onClick={() => owner.current?.cancel()}>{t('capture.cancelWaiting', locale)}</button></div>}
      <section className="monitor-recipe"><div className="capture-toolbar"><h3>{t('monitor.flow.recipe', locale)}</h3>
        <button type="button" className="btn ui-btn-sm" disabled={pending} onClick={readProfiles}>{t('monitor.reload', locale)}</button></div>
      <p className="hint">{t('monitor.flow.reloadHint', locale)}</p>
      {busy === 'profiles' && <Skeleton count={2} />}
      {profiles?.length === 0 && <p className="hint">{t('monitor.flow.empty', locale)}</p>}
      <label>{t('monitor.savedProfiles', locale)}<select aria-label={t('monitor.savedProfiles', locale)} className="ui-select" value={selectedId} disabled={disabled} onChange={event => requestChoose(event.target.value)}><option value="">{t('monitor.newProfile', locale)}</option>{profiles?.map(profile => <option key={profile.id} value={profile.id}>{profile.label} · {profile.agent} · r{profile.revision}</option>)}</select></label>
      {selected !== undefined && <p className="hint mono">{selected.id} · r{selected.revision} · <time dateTime={selected.updatedAt}>{selected.updatedAt}</time></p>}
      {changedRevision && <div role="alert"><p>{t('monitor.flow.changedRevision', locale)}</p><button type="button" className="btn" disabled={pending} onClick={() => requestChoose(selectedId)}>{t('monitor.flow.review', locale)}</button></div>}
      {listIssue && profiles !== null && <p role="alert">{t('monitor.flow.listStale', locale)}</p>}
      <form onSubmit={event => { event.preventDefault();save(); }}>
        <fieldset className="monitor-fields" aria-label={t('monitor.flow.recipe', locale)} disabled={disabled}>
          <label>{t('monitor.label', locale)}<input className="ui-input" value={settings.label} maxLength={80} required onChange={event => change({ label: event.target.value })} /></label>
          <label>{t('monitor.agent', locale)}<select aria-label={t('monitor.agent', locale)} className="ui-select" value={settings.agent} onChange={event => { const agent = event.target.value as MonitorAgent; change({ agent, ...(agent === 'opencode' && settings.noProxy === null ? { noProxy: 'localhost,127.0.0.1,::1' } : {}) }); }}>{agents.map(agent => <option key={agent} value={agent}>{agent}</option>)}</select></label>
          <label className="monitor-project">{t('monitor.project', locale)}<input className="ui-input" value={settings.projectDirectory} maxLength={4096} required placeholder="/absolute/project/path" onChange={event => change({ projectDirectory: event.target.value })} /></label>
          <label>{t('monitor.port', locale)}<input className="ui-input" type="number" min={1} max={65535} step={1} required value={portDraft} onChange={event => { if (owner.current !== null) return;setPortDraft(event.target.value);change({ proxyPort: Number(event.target.value) }); }} /></label>
          <details className="monitor-optional"><summary>{t('monitor.flow.optional', locale)}</summary>
          <label>{t('monitor.executable', locale)}<input className="ui-input" value={settings.executable ?? ''} maxLength={4096} placeholder={settings.agent} onChange={event => change({ executable: event.target.value === '' ? null : event.target.value })} /></label>
          <label className="monitor-bypass"><input type="checkbox" checked={settings.noProxy === null} onChange={event => change({ noProxy: event.target.checked ? null : '' })} />{t('monitor.inheritBypass', locale)}</label>
          {settings.noProxy !== null && <label>{t('monitor.noProxy', locale)}<input className="ui-input" value={settings.noProxy} maxLength={2048} onChange={event => change({ noProxy: event.target.value })} /></label>}
          <p className="hint">{t('monitor.bypassWarning', locale)}</p>
          </details>
          <div className="capture-toolbar"><button type="submit" className="btn ui-btn-primary" disabled={profileBlocked}>{t('monitor.save', locale)}</button>
            <span className="hint" role="status">{t(saved ? 'monitor.flow.saved' : dirty ? 'monitor.flow.unsaved' : selected === undefined ? 'monitor.newProfile' : 'monitor.flow.reviewed', locale)}</span></div>
        </fieldset>
      </form>
      {settings.agent !== 'claude' && <p className="hint">{t(settings.agent === 'opencode' ? 'monitor.openCodeBypass' : 'monitor.codexStandalone', locale)}</p>}
      </section>
      <section className="monitor-actions"><h3>{t('monitor.flow.actions', locale)}</h3><p className="hint">{t('monitor.flow.nextStep', locale)}</p>
      <div className="capture-toolbar"><button type="button" className="btn ui-btn-sm" disabled={pending} onClick={refreshStatus}>{t('monitor.flow.status', locale)}</button>
        {listenerBlocked && <span className="hint">{t('monitor.flow.listenerBlocked', locale)}</span>}</div>
      {selected !== undefined && <><div className="capture-toolbar">
        <button type="button" className="btn ui-btn-primary" disabled={profileBlocked || dirty} onClick={() => getPlan(false)}>{t('monitor.command', locale)}</button>
        <button type="button" className="btn" disabled={profileBlocked || dirty || listenerBlocked || unknown.runtime} onClick={() => getPlan(true)}>{t('monitor.startListener', locale)}</button>
        <button type="button" className="btn" disabled={profileBlocked || dirty} onClick={diagnose}>{t('monitor.diagnose', locale)}</button>
        <button type="button" className="btn" disabled={profileBlocked || dirty || listenerBlocked || unknown.runtime || unknown.selfTest} onClick={testCapture}>{t('monitor.selfTest', locale)}</button>
      </div><p className="hint">{t('monitor.selfTestScope', locale)}</p>
      {dirty && <p className="hint">{t('monitor.saveFirst', locale)}</p>}
      <details><summary>{t('monitor.flow.maintenance', locale)}</summary><button type="button" className="btn ui-btn-danger" disabled={profileBlocked} onClick={() => setConfirmDelete(true)}>{t('monitor.delete', locale)}</button></details></>}
      </section>
      {switchTo !== null && <Modal size="sm" title={t('monitor.flow.discardTitle', locale)} onClose={() => setSwitchTo(null)}>
        <p>{t('monitor.flow.discardHint', locale)}</p><div className="capture-toolbar"><button type="button" className="btn" onClick={() => setSwitchTo(null)}>{t('settings.keepEditing', locale)}</button>
        <button type="button" className="btn ui-btn-danger" onClick={() => { choose(switchTo);setSwitchTo(null); }}>{t('monitor.flow.discard', locale)}</button></div>
      </Modal>}
      {confirmDelete && <Modal size="sm" title={t('monitor.confirmDelete', locale)} onClose={() => setConfirmDelete(false)}>
        <p>{selected?.label} · <code>{selected?.id}</code></p><p>{t('monitor.flow.deleteScope', locale)}</p><div className="capture-toolbar">
        <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>{t('common.cancel', locale)}</button>
        <button type="button" className="btn ui-btn-danger" disabled={profileBlocked} onClick={remove}>{t('common.confirm', locale)}</button></div>
      </Modal>}
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
        <ul>{diagnostics.issues.map(issue => <li key={issue.code}><span>[{t(`monitor.severity.${issue.severity}`, locale)}] </span><code>{issue.code}</code><p>{t(`monitor.check.${issue.code}`, locale)}</p><p className="hint">{issue.nextStep}</p></li>)}</ul>
      </section>}
      {plan !== null && <div className="monitor-command">
        <p>{t('monitor.runExplicitly', locale)}</p>
        <label>{t('monitor.shell', locale)}<select aria-label={t('monitor.shell', locale)} className="ui-select" disabled={pending} value={shell} onChange={event => { setShell(event.target.value as typeof shell); setCopied(false); }}><option value="posix">POSIX (macOS / Linux)</option><option value="powershell">PowerShell</option></select></label>
        <textarea aria-label={t('monitor.launchCommand', locale)} className="ui-input mono" readOnly rows={5} value={plan.commands[shell]} />
        <button type="button" className="btn" disabled={pending} onClick={() => run('copy', async () => navigator.clipboard.writeText(plan.commands[shell]), () => setCopied(true))}>{t(copied ? 'monitor.copied' : 'monitor.copy', locale)}</button>
        <p className="hint">{t('monitor.unverified', locale)}</p><p className="mono" style={{ overflowWrap: 'anywhere' }}>CA SHA-256: {plan.caSha256}</p>
      </div>}
    </section>
  );
}
