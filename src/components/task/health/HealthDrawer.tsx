import { Badge } from '../../ui/Badge.js';
import { Tooltip } from '../../ui/Overlay.js';
import { IconFileText } from '../../icons/index.js';
import { Sheet } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { Select, Combobox } from '../../ui/Select.js';
import { Accordion, Callout, Meter } from '../../ui/Display.js';
import { Tabs } from '../../ui/Tabs.js';
import { EmptyState, Skeleton } from '../../ui/States.js';
import { RequestListNotice } from '../TaskRequests.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Locale } from '../../../i18n.js';
import type { TaskContext } from '../../../core/task-types.js';
import type { DeepHealthReport, HealthEvidence, HealthReport, HealthScope } from '../../../core/task-health/types.js';
import { ApiError } from '../../../api/client.js';
import { formatHealthDate, healthLabel } from '../../../core/task-health/format.js';
import { taskApi, useTaskRead } from '../task-data.js';
import { healthApi } from './health-client.js';
import type { HealthDeepPreview, HealthModelStatus, HealthReportIndexItem } from './health-client.js';
import { healthCopy, healthErrorCopy } from './health-copy.js';
import { DeepHealthReportView } from './DeepHealthReportView.js';
import { HealthReportView } from './HealthReportView.js';

export function HealthDrawer({ context, locale, reportId, request, from, to, onReport, onClose, onLocate, sourceVersion = 0, evidenceUnavailable = false }: {
  context: TaskContext; locale: Locale; reportId: string; request?: string; from?: string; to?: string;
  onReport: (id: string) => void; onClose: () => void; onLocate: (evidence: HealthEvidence, recordId: string,request?:string) => void;
  sourceVersion?: number; evidenceUnavailable?: boolean;
}) {
  const c = healthCopy(locale), taskId = context.task.id;
  const [deepReport, setDeepReport] = useState<DeepHealthReport | null>(null), [preview, setPreview] = useState<HealthDeepPreview | null>(null), [model, setModel] = useState<HealthModelStatus | null>(null), [tab, setTab] = useState<'standard' | 'deep'>('standard');
  const [selection, setSelection] = useState(request||context.task.eventCount>20000?'request':'all'), [prepared, setPrepared] = useState<TaskContext | null>(null);
  const [report, setReport] = useState<HealthReport | null>(null), [history, setHistory] = useState<HealthReportIndexItem[]>([]);
  const [busy, setBusy] = useState(false), [historyBusy, setHistoryBusy] = useState(false), [error, setError] = useState(''), [historyError, setHistoryError] = useState(false), [message, setMessage] = useState<'cancelled' | 'preparing' | 'updated' | ''>('');
  const requests=useTaskRead(selection==='request'?JSON.stringify([taskId,context.task.updatedAt,context.task.eventCount,context.task.loadedMemberCount,prepared?.task.eventCount,prepared?.task.loadedMemberCount]):null,signal=>taskApi.requests(taskId,signal),10000);
  const [chosenRequest,setChosenRequest]=useState(request??'');
  const requestItems=requests.value?.items??[];
  const requestId=chosenRequest?requestItems.find(r=>r.id===chosenRequest)?.id:requestItems.at(-1)?.id;
  const selectedRequest=chosenRequest||requestItems.at(-1)?.id;
  const scope: HealthScope = { ...(selection==='request'&&selectedRequest?{request:selectedRequest}:{}), member: selection === 'main' ? 'main' : 'all', from: selection === 'window' ? from ?? null : null, to: selection === 'window' ? to ?? null : null };
  const identity = JSON.stringify([taskId, selection, scope.request, scope.from, scope.to, context.task.updatedAt, sourceVersion]);
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
  const generate = () => { if(selection==='request'&&!requestId)return; void run(async signal => {
    const value = await healthApi.generate(taskId, scope, signal);
    if (signal.aborted || currentIdentity.current !== identity) return;
    activeReport.current = value; setReport(value); setDeepReport(null); setPreview(null); setTab('standard'); callbacks.current.onReport(value.id);
    setHistory(old => [{ ...summary(value), id: value.id, generatedAt: value.generatedAt, mode: 'standard' as const, revision: value.revision, expired: false, reportId: null }, ...old.filter(item => item.id !== value.id)].slice(0, 50));
  });
  };
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
    setHistory(old => [{ ...summary(parent), id: value.id, generatedAt: value.generatedAt, mode: 'deep' as const, revision: parent.revision, expired: false, reportId: parent.id }, ...old.filter(item => item.id !== value.id)].slice(0, 50));
  }, 125000, true); };
  const readDeep = (id: string) => void run(async signal => {
    const value = await healthApi.readDeep(id, taskId, signal);
    let parent: HealthReport | null = null;
    try { parent = await healthApi.read(value.reportId, taskId, signal); }
    catch (e) { if (!(e instanceof ApiError) || e.code !== 'HEALTH_REPORT_NOT_FOUND') throw e; }
    if (signal.aborted || currentIdentity.current !== identity) return;
    setReport(parent); activeReport.current = parent; setDeepReport(value); setTab('deep'); setPreview(null);
  });
  const prepare = () => void run(async signal => {
    const page = await taskApi.records(taskId, { member: 'all', offset: 0, limit: 200 }, signal);
    if (signal.aborted || currentIdentity.current !== identity) return;
    setPrepared(page.context); setMessage('preparing');
  });
  const data = prepared ?? context;
  const summary=(value:HealthReport)=>({scope:value.scope,severity:{warning:value.findings.filter(f=>f.severity==='warning').length,notice:value.findings.filter(f=>f.severity==='notice').length,info:value.findings.filter(f=>f.severity==='info').length}});
  const scopeLabel=(value:HealthReportIndexItem)=>!value.scope?'—':value.scope.request?`${locale==='zh'?'请求':'Request'} ${requestItems.find(r=>r.id===value.scope?.request)?.ordinal??value.scope.request}`:value.scope.from?`${value.scope.from} → ${value.scope.to}`:value.scope.member==='all'?c.all:value.scope.member==='main'?c.main:value.scope.member;
  const generationDisabled=busy||selection==='request'&&!requestId||selection==='window'&&(!from||!to);
  const deepReason=busy?(locale==='zh'?'请等待当前分析完成':'Wait for the current operation'):!report?(locale==='zh'?'请先生成标准报告':'Generate a standard report first'):model?.configured===false?c.noModel:'';
  const generateLabel=locale==='zh'?'生成标准报告':'Generate standard report',deepLabel=locale==='zh'?'深度分析':'Deep analysis';

  return <Sheet open title={c.title} onClose={onClose} className="health-drawer">
    <div id="task-health-drawer"><div className="health-sheet-controls"><Select aria-label={c.scope} prefix={c.scope} value={selection} onChange={event=>{setSelection(event.target.value);onReport('new');}} options={[{value:"all",label:c.all},{value:"request",label:requestId?`${locale==='zh'?'请求':'Request'} ${requestItems.find(r=>r.id===requestId)?.ordinal??'—'}`:locale==='zh'?'按请求分析':'Analyze a request'},{value:"main",label:c.main},{value:"window",label:c.window,disabled:!from||!to}]}/><Button type="button" variant="primary" disabled={generationDisabled} onClick={generate}>{generateLabel}</Button><Tooltip label={deepReason||(locale==='zh'?'预览证据后确认调用模型':'Preview evidence before confirming a model call')}><span tabIndex={deepReason?0:undefined}><Button variant="secondary" disabled={Boolean(deepReason)} onClick={showPreview}>{deepLabel}</Button></span></Tooltip></div>
    {context.task.eventCount>20000&&<Callout tone="attention" title={locale==='zh'?'任务超过 20,000 事件':'Task exceeds 20,000 events'}>{locale==='zh'?'建议按请求分析；选择下方请求可直接生成报告。':'Analyze a request below within the report limits.'}</Callout>}
    {selection==='request'&&<div><RequestListNotice loading={requests.loading} error={requests.error} empty={Boolean(requests.value&&!requestItems.length)} locale={locale} retry={requests.retry}/>
      {context.task.eventCount>20000&&<div className="health-request-list">{requestItems.slice(0,20).map(r=><Button key={r.id} variant={requestId===r.id?'secondary':'ghost'} onClick={()=>{setChosenRequest(r.id);onReport('new');}}>{r.ordinal}. {r.title}</Button>)}</div>}{requestItems.length>0&&<Combobox label={locale==='zh'?'健康请求':'Health request'} value={requestId??''} onChange={id=>{setChosenRequest(id);onReport('new');}} options={requestItems.map(r=>({value:r.id,label:`${r.ordinal}. ${r.title}`}))}/>}
    </div>}
    <div className="health-preparation"><span>{locale==='zh'?'数据准备':'Data preparation'}</span><Meter label={c.coverage} value={data.task.loadedMemberCount} max={data.task.memberCount}/><span className="num">{data.task.loadedMemberCount}/{data.task.memberCount} {c.coverage} · {report?Object.entries(report.coverage.timing).filter(([,n])=>n>0).map(([key,n])=>`${healthLabel(key,locale)} ${n}`).join(' / '):c.unknownTiming}</span><Button size="sm" variant="ghost" disabled={busy} onClick={prepare}>{c.prepare}</Button>{busy&&<Button size="sm" variant="ghost" onClick={cancel}>{c.cancel}</Button>}</div>
    {data.task.loadedMemberCount<data.task.memberCount&&<Callout title={c.insufficient} tone="attention"/>}
    {!report&&!deepReport&&!busy&&!error&&<EmptyState icon={<IconFileText/>} title={locale==='zh'?'尚未生成报告':'No report generated yet'} action={<Button variant="primary" disabled={generationDisabled} onClick={generate}>{generateLabel}</Button>}/>}
    {model?.configured===false&&<Button variant="ghost" onClick={()=>void run(async signal=>{const status=await healthApi.modelStatus(signal);if(!signal.aborted&&currentIdentity.current===identity)setModel(status);})}>{locale==='zh'?'检查模型配置':'Check model configuration'}</Button>}
    {busy && <Skeleton variant="row"/>}{error && <p role="alert">{error}</p>}{message && <p role="status">{c[message]}</p>}{evidenceUnavailable && <p role="alert">{c.inaccessible}</p>}
    <Accordion title={c.history}><div className="health-toolbar"><Button variant="ghost" disabled={historyBusy} onClick={()=>void loadHistory()}>{c.refresh}</Button></div>{historyBusy&&<Skeleton/>}{historyError&&<Callout title={c.error} tone="danger"/>}{!historyBusy&&!history.length&&<p>{c.empty}</p>}
      <ul className="health-history-list">{history.map(item=><li key={item.id}><Button variant="ghost" disabled={busy} aria-current={(item.mode==='standard'?report?.id:deepReport?.id)===item.id?'true':undefined} onClick={()=>{
        if(item.mode==='deep'){readDeep(item.id);return;}
        if(item.id===reportId){if(!report&&!busy)void run(async signal=>{const value=await healthApi.read(item.id,taskId,signal);if(!signal.aborted&&currentIdentity.current===identity)setReport(value);});return;}
        sequence.current++;owner.current?.abort();setReport(null);setPreview(null);setDeepReport(null);setTab('standard');onReport(item.id);
      }}><span className="health-history-title">{formatHealthDate(item.generatedAt,locale)} · {item.mode==='standard'?c.standardTab:c.deepTab}{item.expired?` · ${c.updated}`:''}</span><span className="health-history-meta"><span>{scopeLabel(item)}</span><Tooltip label={item.mode==='deep'?(locale==='zh'?'父级标准报告的问题数':'Findings in the parent standard report'):(locale==='zh'?'标准报告的问题数':'Standard report findings')}><span className="health-history-severity">{item.severity?<><Badge tone="danger">{locale==='zh'?'警告':'Warning'} {item.severity.warning}</Badge><Badge tone="attention">{locale==='zh'?'注意':'Notice'} {item.severity.notice}</Badge><Badge>{locale==='zh'?'信息':'Info'} {item.severity.info}</Badge></>:<Badge>—</Badge>}</span></Tooltip></span></Button></li>)}</ul>
    </Accordion>
    {preview && <section aria-label={c.preview}><h3>{c.preview}</h3><p>{c.redacted} · {preview.estimate.bytes} bytes · {c.estimatedTokens}: {preview.estimate.inputTokens} / {preview.estimate.outputTokens}</p><p>{c.model}: {model?.provider} / {model?.model}</p><Accordion title={c.evidence}><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '20rem', overflow: 'auto' }}>{JSON.stringify(preview.pack, null, 2)}</pre></Accordion><Button type="button" variant="secondary" disabled={busy||(selection==='request'&&!requestId)} onClick={confirmDeep}>{c.confirm}</Button><Button type="button" variant="secondary" onClick={() => setPreview(null)}>{c.cancel}</Button></section>}
    {report&&<Tabs activeId={tab} onChange={id=>setTab(id as 'standard'|'deep')} items={[{id:'standard',label:c.standardTab},{id:'deep',label:c.deepTab,disabled:!deepReport}]}/>}
    {report && tab === 'standard' && <div role="tabpanel"><HealthReportView report={report} locale={locale} onLocate={(e,id)=>report.scope.request?onLocate(e,id,report.scope.request):onLocate(e,id)}/></div>}
    {deepReport && tab === 'deep' && <div role="tabpanel"><DeepHealthReportView report={deepReport} parent={report ?? undefined} locale={locale}/></div>}
  </div></Sheet>;
}
