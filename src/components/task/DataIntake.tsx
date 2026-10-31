import { PageHeader } from '../PageHeader.js';
import { Card, CardHeader, CardBody, Accordion, Callout } from '../ui/Display.js';
import { Badge } from '../ui/Badge.js';
import { Switch } from '../ui/Controls.js';
import { LocalProviderTable } from './LocalProviderTable.js';
import { IconFile, IconNetwork, IconPlug, IconFrida, IconTerminal } from '../icons/index.js';
import { Button } from '../ui/Button.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { TelemetryIntakePanel } from '../TelemetryIntakePanel.js';
import '../../styles/components/intake.css';
import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import { api, fetchJson } from '../../api/client.js';
import type { Locale } from '../../i18n.js';
import { copy } from './copy.js';
import { useTaskRead } from './task-data.js';
const TraceLogImportPanel = lazy(() => import('../TraceLogImportPanel.js').then(module => ({ default: module.TraceLogImportPanel })));
const CdpPanel = lazy(() => import('../CdpPanel.js').then(module => ({ default: module.CdpPanel })));
type Channel = 'native' | 'proxy' | 'cdp' | 'frida' | 'import' | 'otel';
interface Monitoring { enabled: boolean; state: 'idle' | 'starting' | 'running' | 'stopping' }
/** Channel choice explains evidence coverage before exposing a channel's actual controls. */
export function DataIntake({ locale, initialChannel = 'native', onConfigure, proxy, frida, onSearch, onMenu }: {
  onSearch?:()=>void; onMenu?:()=>void; locale: Locale; initialChannel?: Channel; onConfigure: () => void; proxy: ReactNode; frida: ReactNode; onTasks: () => void;
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
    { id: 'native', title: c.localTitle, hint: c.localHint, tag: c.nativeFirst, mark: <IconTerminal/> },
    { id: 'proxy', title: c.proxyTitle, hint: c.proxyHint, tag: c.network, mark: <IconNetwork/> },
    { id: 'otel', title: 'OpenTelemetry', hint: locale === 'zh' ? '接收自研 Agent 的 OTLP/HTTP JSON。默认关闭，仅限本机。' : 'Receive custom Agent OTLP/HTTP JSON. Default off, local only.', tag: 'OTLP · JSON', mark: <IconPlug/> },
    { id: 'import', title: c.importTitle, hint: c.importHint, tag: c.historicalTag, mark: <IconFile/> },
    { id: 'cdp', title: c.cdpTitle, hint: c.cdpHint, tag: 'Chromium', mark: <IconNetwork/> },
    { id: 'frida', title: c.fridaTitle, hint: c.fridaHint, tag: 'Process', mark: <IconFrida/> },
  ] as const;
  const renderChannel = (item: typeof channels[number]) => <Card key={item.id} className={`intake-channel ${channel === item.id ? 'is-selected' : ''}`}><CardBody><div className="intake-channel-title"><span className="intake-icon">{item.mark}</span><h2>{item.title}</h2><Badge tone={item.id==='native'&&monitoring.value?.enabled?'success':'neutral'}>{item.id==='native'&&monitoring.value ? c[monitoring.value.enabled?'monitoringOn':'monitoringOff'] : locale==='zh'?'按需配置':'Configure on demand'}</Badge></div><p>{item.hint}</p><Button variant="link" aria-label={`${item.title} · ${c.configure}`} aria-pressed={channel===item.id} onClick={()=>setChannel(item.id)}>{c.configure} →</Button></CardBody></Card>;
  return <main className="f5-intake"><PageHeader onSearch={onSearch} onMenu={onMenu} locale={locale} title={locale==='zh'?'数据接入':'Data intake'} description={locale==='zh'?'选择数据来源，数据只保存在本机':'Choose a data source. Data stays on this device.'}/>
    <div className="intake-grid">{channels.filter(item=>['native','otel','import'].includes(item.id)).map(renderChannel)}</div>
    <Accordion title={locale==='zh'?'高级通道':'Advanced channels'} defaultOpen={['proxy','frida','cdp'].includes(initialChannel)}><div className="intake-grid">{channels.filter(item=>['proxy','frida','cdp'].includes(item.id)).map(renderChannel)}</div></Accordion>
    <Card><CardHeader title={channels.find(item=>item.id===channel)?.title} description={channels.find(item=>item.id===channel)?.hint}/><CardBody>
        {channel === 'native' && <><div className="intake-actions"><Switch aria-label={c.enable} label={monitoring.value ? c[monitoring.value.enabled ? 'monitoringOn' : 'monitoringOff'] : c.checkState} checked={monitoring.value?.enabled??false} disabled={busy||!monitoring.value} onChange={()=>void toggle()}/><Button onClick={onConfigure}>{c.configure}</Button><Button onClick={monitoring.retry}>{c.checkState}</Button></div>{monitoring.loading&&<PageSkeleton compact/>}{(error||monitoring.error)&&<Callout tone="danger" title={error??monitoring.error!}/>}<LocalProviderTable locale={locale}/></>}
        {channel === 'otel' && <TelemetryIntakePanel locale={locale} />}
        {channel === 'proxy' && proxy}{channel === 'frida' && frida}
        <Suspense fallback={<PageSkeleton compact />}>{channel === 'cdp' && <CdpPanel locale={locale} />}{channel === 'import' && <><TelemetryIntakePanel locale={locale} file />{proxyState.loading && <PageSkeleton compact />}{proxyState.error && <p role="alert">{proxyState.error}</p>}<TraceLogImportPanel locale={locale} stopped={proxyState.value !== null && !proxyState.value.running && !proxyState.value.starting} /></>}</Suspense>
      </CardBody></Card>
  </main>;
}
