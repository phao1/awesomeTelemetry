import '../../styles/task-workbench.css';
import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import { api, fetchJson } from '../../api/client.js';
import type { Locale } from '../../i18n.js';
import { copy } from './copy.js';
import { useTaskRead } from './task-data.js';
const TraceLogImportPanel = lazy(() => import('../TraceLogImportPanel.js').then(module => ({ default: module.TraceLogImportPanel })));
const CdpPanel = lazy(() => import('../CdpPanel.js').then(module => ({ default: module.CdpPanel })));
type Channel = 'native' | 'proxy' | 'cdp' | 'frida' | 'import';
interface Monitoring { enabled: boolean; state: 'idle' | 'starting' | 'running' | 'stopping' }
/** Channel choice explains evidence coverage before exposing a channel's actual controls. */
export function DataIntake({ locale, initialChannel = 'native', onConfigure, proxy, frida, onTasks }: {
  locale: Locale; initialChannel?: Channel; onConfigure: () => void; proxy: ReactNode; frida: ReactNode; onTasks: () => void;
}): React.JSX.Element {
  const c = copy(locale), [channel, setChannel] = useState<Channel>(initialChannel), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const read = useCallback((signal: AbortSignal) => fetchJson<Monitoring>('/monitoring', { signal }), []);
  const monitoring = useTaskRead('monitoring', read, 10000);
  const readProxy = useCallback((signal: AbortSignal) => api.proxyStatus(signal), []);
  const proxyState = useTaskRead(channel === 'import' ? 'proxy-status-import' : null, readProxy, 10000);
  const toggle = async (): Promise<void> => {
    if (busy || monitoring.value === null) return;
    setBusy(true); setError(null);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try { await fetchJson<Monitoring>('/monitoring', { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !monitoring.value.enabled }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { clearTimeout(timeout); setBusy(false); monitoring.retry(); }
  };
  const channels = [
    { id: 'native', title: c.localTitle, hint: c.localHint, tag: c.nativeFirst, mark: '⌁' },
    { id: 'proxy', title: c.proxyTitle, hint: c.proxyHint, tag: c.network, mark: '⇄' },
    { id: 'import', title: c.importTitle, hint: c.importHint, tag: c.historicalTag, mark: '↓' },
    { id: 'cdp', title: c.cdpTitle, hint: c.cdpHint, tag: 'Chromium', mark: '◉' },
    { id: 'frida', title: c.fridaTitle, hint: c.fridaHint, tag: 'Process', mark: '⌘' },
  ] as const;
  return <main className="task-intake"><header className="task-intake-heading"><div><span className="task-eyebrow">DATA INTAKE</span><h1>{c.logsTitle}</h1><p>{c.logsHint}</p></div><button type="button" className="btn" onClick={onTasks}>{c.tasks} ↗</button></header>
    <div className="task-intake-layout"><nav className="task-channel-list" aria-label={c.intake}>{channels.map(item => <button type="button" key={item.id} className={`task-channel ${channel === item.id ? 'is-selected' : ''}`} aria-current={channel === item.id ? 'true' : undefined} onClick={() => setChannel(item.id)}><span className="task-channel-mark">{item.mark}</span><span><strong>{item.title}</strong><small>{item.tag}</small></span><span>›</span></button>)}</nav>
      <section className="task-channel-content"><div className="task-channel-intro"><span className="task-badge">{channels.find(item => item.id === channel)?.tag}</span><h2>{channels.find(item => item.id === channel)?.title}</h2><p>{channels.find(item => item.id === channel)?.hint}</p></div>
        {channel === 'native' && <><div className="task-monitor-card"><span className={`task-state-dot ${monitoring.value?.enabled ? '' : 'idle'}`} /><div><h3>{monitoring.value ? c[monitoring.value.enabled ? 'monitoringOn' : 'monitoringOff'] : c.loading}</h3><p>{c.monitoringHint}</p></div><button type="button" className="btn ui-btn-primary" disabled={busy || monitoring.value === null} onClick={() => void toggle()}>{busy ? c.transition : c[monitoring.value?.enabled ? 'stop' : 'enable']}</button></div>
          {(error || monitoring.error) && <p role="alert">{error ?? monitoring.error}</p>}<div className="task-channel-actions"><button type="button" className="btn" onClick={onConfigure}>{c.configure} ↗</button><button type="button" className="btn" onClick={monitoring.retry}>{c.checkState}</button><button type="button" className="btn" onClick={() => void api.scan().then(() => monitoring.retry()).catch(cause => setError(String(cause)))}>{c.refresh}</button></div><p className="hint">{c.noPolling}</p></>}
        {channel === 'proxy' && proxy}{channel === 'frida' && frida}
        <Suspense fallback={<p role="status">{c.loading}</p>}>{channel === 'cdp' && <CdpPanel locale={locale} />}{channel === 'import' && <>{proxyState.loading && <p role="status">{c.loading}</p>}{proxyState.error && <p role="alert">{proxyState.error}</p>}<TraceLogImportPanel locale={locale} stopped={proxyState.value !== null && !proxyState.value.running && !proxyState.value.starting} /></>}</Suspense>
      </section>
    </div>
  </main>;
}
