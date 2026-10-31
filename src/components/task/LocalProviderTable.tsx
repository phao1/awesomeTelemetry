import { formatRelativeTime, formatAbsoluteTime } from '../../core/format.js';
import { Tooltip } from '../ui/Overlay.js';
import { useCallback, useState } from 'react';
import { api, fetchJson } from '../../api/client.js';
import { PROVIDER_KEYS, type ProviderStatusResponse, type LocalSessionConfig } from '../../core/trace-types.js';
import type { Locale } from '../../i18n.js';
import { useTaskRead } from './task-data.js';
import { Table } from '../ui/Table.js';
import { Badge, ProviderBadge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Callout } from '../ui/Display.js';
export function LocalProviderTable({locale}:{locale:Locale}):React.JSX.Element {
 const zh=locale==='zh', [busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 const read=useCallback(async(signal:AbortSignal)=>{const [config,mission]=await Promise.allSettled([api.configProviders(signal),fetchJson<ProviderStatusResponse>('/providers/status',{signal})]);if(config.status==='rejected')throw config.reason;const local=config.value as LocalSessionConfig;if(!local?.providers||PROVIDER_KEYS.some(key=>!local.providers[key]))throw new Error('CONFIG_RESPONSE_INVALID');return {config:local,collectors:mission.status==='fulfilled'?mission.value.providers??null:null};},[]);
 const data=useTaskRead('intake-providers',read,10000);
 return <>{(error||data.error)&&<Callout tone="danger" title={error||data.error!}/>}<Table locale={locale} loading={data.loading} rows={data.value?PROVIDER_KEYS.map(key=>({config:data.value!.config.providers[key],state:data.value!.collectors?.find(p=>p.key===key)})):[]} rowKey={row=>row.config.key} columns={[
 {key:'provider',label:zh?'工具':'Provider',render:row=><ProviderBadge provider={row.config.key} locale={locale} showLabel/>},
 {key:'path',label:zh?'路径':'Path',render:row=>row.config.path},
 {key:'count',label:zh?'会话数':'Sessions',align:'right',render:row=>row.state?.sessionCount??'—'},
 {key:'time',label:zh?'最近扫描':'Last scan',render:row=>row.state?.lastScanAt?<Tooltip label={formatAbsoluteTime(row.state.lastScanAt,locale)+' · '+row.state.lastScanAt}><time dateTime={row.state.lastScanAt} title={row.state.lastScanAt}>{formatRelativeTime(row.state.lastScanAt,locale)}</time></Tooltip>:'—'},
 {key:'status',label:zh?'状态':'Status',render:row=><Badge tone={!row.config.enabled?'neutral':row.state?.pathExists===false?'attention':row.state?.ready===false?'attention':'success'}>{!row.config.enabled?(zh?'未启用':'Disabled'):row.state?.pathExists===false?(zh?'未找到目录':'Path not found'):row.state?.ready===false?(zh?'需要配置':'Setup required'):(zh?'已启用':'Enabled')}</Badge>},
 {key:'scan',label:zh?'操作':'Action',render:row=><Button disabled={busy!==null} loading={busy===row.config.key} onClick={()=>{setBusy(row.config.key);setError('');void api.scan(row.config.key).then(data.retry).catch((cause:unknown)=>setError(String(cause))).finally(()=>setBusy(null));}}>{zh?'扫描':'Scan'}</Button>},
 ]}/></>;
}
