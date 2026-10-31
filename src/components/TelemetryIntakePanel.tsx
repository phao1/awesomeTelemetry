import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n.js';
import type { TelemetryImportResult, TelemetryStatus } from '../core/telemetry-types.js';
import { fetchJson } from '../api/client.js';
import { useTaskRead } from './task/task-data.js';
import { Button } from './ui/Button.js';
import { Switch } from './ui/Controls.js';
import { Card, CardHeader, CardBody, CopyField, StatCard, Callout } from './ui/Display.js';
import { Field } from './ui/Field.js';
import { Dropzone } from './ui/Dropzone.js';
import { Table } from './ui/Table.js';
import { Skeleton } from './ui/States.js';
import '../styles/components/intake.css';

export function TelemetryIntakePanel({ locale, file = false }: { locale: Locale; file?: boolean }): React.JSX.Element {
  const zh = locale === 'zh', owner = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [token, setToken] = useState<string | null>(null);
  const [requireToken, setRequireToken] = useState(true), [history, setHistory] = useState<Array<{name:string;at:string;result:TelemetryImportResult}>>([]);
  const read = useCallback((signal: AbortSignal) => fetchJson<TelemetryStatus>('/telemetry', { signal }), []);
  const status = useTaskRead(file ? null : 'telemetry', read, 10000);
  useEffect(() => () => { owner.current?.abort(); owner.current = null; }, []);
  const action = async (run: (signal: AbortSignal) => Promise<void>) => {
    if (owner.current) return;
    const controller = new AbortController(); owner.current = controller; setBusy(true); setError(null);
    const timeout = setTimeout(() => {if(owner.current!==controller)return;controller.abort();owner.current=null;setBusy(false);setError(zh?'操作超时，请刷新实际状态。':'Operation timed out. Refresh the actual state.');}, 45000);
    try { await run(controller.signal); }
    catch (cause) { if (owner.current === controller) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { clearTimeout(timeout); if (owner.current === controller) { owner.current = null; setBusy(false); if (!file) status.retry(); } }
  };
  const toggle = () => action(async signal => {
    const next = await fetchJson<TelemetryStatus & { token?: string }>('/telemetry', { method: 'PUT', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !status.value?.enabled, requireToken: status.value?.enabled ? status.value.requireToken : requireToken }) });
    if (!signal.aborted) setToken(next.token ?? null);
  });
  const upload=(selected:File|undefined)=>{
    if(!selected||busy)return;
    if(selected.size>8*1024*1024){setError(zh?'文件超过 8 MiB 上限':'File exceeds 8 MiB limit');return;}
    void action(async signal=>{const result=await fetchJson<TelemetryImportResult>('/telemetry/import',{method:'POST',signal,headers:{'content-type':/\.(jsonl|ndjson)$/i.test(selected.name)?'application/x-ndjson':'application/json'},body:selected});if(!signal.aborted)setHistory(previous=>[{name:selected.name,at:new Date().toISOString(),result},...previous].slice(0,20));});
  };
  if(file)return <Card><CardHeader title={zh?'OTLP / Langfuse / LangSmith 文件':'OTLP / Langfuse / LangSmith files'} description={zh?'支持 JSON / JSONL / NDJSON，最大 8 MiB；自动识别格式，数据保存在本机。':'JSON / JSONL / NDJSON, up to 8 MiB. Auto-detected and stored locally. Open Imported tasks to inspect.'}/><CardBody><Dropzone label={zh?'选择遥测导出文件':'Choose telemetry export'} description={zh?'拖入文件或点击选择':'Drop a file or choose one'} accept=".json,.jsonl,.ndjson" disabled={busy} onFile={upload}/>{busy&&<Skeleton variant="row"/>}{error&&<Callout tone="danger" title={error}/>}</CardBody><Table locale={locale} label={zh?'本次访问的导入历史':'Import history for this visit'} rows={history} rowKey={row=>row.at+row.name} columns={[
    {key:'file',label:zh?'文件':'File',render:row=>row.name},{key:'format',label:zh?'格式':'Format',render:row=>row.result.format},{key:'spans',label:'Spans',align:'right',render:row=>row.result.spanCount},{key:'tasks',label:zh?'任务':'Tasks',align:'right',render:row=>row.result.taskIds.length},{key:'time',label:zh?'时间':'Time',render:row=>row.at},
  ]}/></Card>;
  const value=status.value;
  return <div className="telemetry-intake">
    {(status.error||error)&&<Callout tone="danger" title={error??status.error!}/>}
    {status.loading&&<Skeleton variant="row" count={3}/>}
    {value&&<><Card><CardHeader title="OpenTelemetry" description={zh?'默认关闭，仅限本机；客户端需安装 OTel SDK 并支持 http/json。':'Default off, local only. Requires client OTel instrumentation and http/json.'}/><CardBody>
      <Field label={zh?'接收状态':'Receiver status'}><Switch aria-label={zh?'启用接收':'Enable receiver'} label={value.enabled?(zh?'接收已启用':'Receiver enabled'):(zh?'接收已停用':'Receiver disabled')} checked={value.enabled} disabled={busy} onChange={()=>void toggle()}/></Field>
      <Field label={zh?'启用 Bearer token（启用时生成；仅显示一次）':'Require Bearer token (generated on enable, displayed once)'}><Switch aria-label="Bearer token" checked={value.enabled?value.requireToken:requireToken} disabled={busy||value.enabled} onChange={event=>setRequireToken(event.target.checked)}/></Field>
      {token&&<Field label={zh?'一次性 token':'One-time token'}><CopyField locale={locale} label={zh?'一次性 token':'One-time token'} value={token} secret/></Field>}
      <Field label={zh?'接收地址':'Receiver endpoint'}><CopyField locale={locale} label={zh?'接收地址':'Receiver endpoint'} value={value.endpoint}/></Field>
      <Callout title={zh?'重新生成 token':'Rotate token'}>{zh?'停用后再次启用会重新生成 token。重启后不会自动开启接收。':'Disable and enable again to regenerate the token. Collection remains off after restart.'}</Callout>
    </CardBody></Card>
    <div className="f5-stats"><StatCard label="Spans" value={value.spanCount}/><StatCard label="Traces" value={value.traceCount}/><StatCard label={zh?'拒绝次数':'Rejections'} value={value.rejectedCount}/></div>
    <Card><CardHeader title={zh?'拒绝原因':'Rejection reasons'}/><Table locale={locale} rows={Object.entries(value.reasons)} rowKey={row=>row[0]} columns={[{key:'reason',label:zh?'原因':'Reason',render:row=>row[0]},{key:'count',label:zh?'次数':'Count',align:'right',render:row=>row[1]}]}/></Card>
    <Card><CardHeader title={zh?'环境变量':'Environment variables'} description={zh?'不支持 protobuf；变量不会自动安装 SDK。':'Protobuf is unsupported. Variables do not install an SDK.'}/><CardBody><CopyField locale={locale} label={zh?'复制环境变量':'Copy environment variables'} value={`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${value.endpoint}\nOTEL_EXPORTER_OTLP_PROTOCOL=http/json\nOTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>`}/><pre className="mono">{`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${value.endpoint}\nOTEL_EXPORTER_OTLP_PROTOCOL=http/json\nOTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>`}</pre></CardBody></Card>
    <p>{zh?'最近接收':'Last received'}: {value.lastReceivedAt??'—'}</p></>}
    <Button disabled={busy} onClick={status.retry}>{zh?'刷新统计':'Refresh statistics'}</Button>
  </div>;
}
