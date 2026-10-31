import type { CompareResult } from '../compare-types.js';
import { comparisonExportLines } from './compare-export.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { CompareTaskPicker, CompareRequestPicker } from './CompareTaskPicker.js';
import { CompareHealthDifferences } from './CompareHealthDifferences.js';
import { CompareTaskTokens } from './CompareTaskTokens.js';
import { PageHeader } from '../PageHeader.js';
import { Card, CardBody, CardHeader, Accordion, Callout, Pill } from '../ui/Display.js';
import { Button, IconButton } from '../ui/Button.js';
import { Checkbox } from '../ui/Controls.js';
import { Select } from '../ui/Select.js';
import { Badge } from '../ui/Badge.js';
import { Tooltip, DropdownMenu } from '../ui/Overlay.js';
import { EmptyState } from '../ui/States.js';
import { VerdictCard } from '../ui/VerdictCard.js';
import { IconCompare, IconDownload } from '../icons/index.js';
import { formatTokens, formatDuration, formatPercent } from '../../core/format.js';
import { isSystemRecord } from '../../core/system-records.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../i18n.js';
import type { TaskComparisonSnapshot, TaskSummary } from '../../core/task-types.js';
import type { HealthReport } from '../../core/task-health/types.js';
import { comparisonConfounded, comparisonLimitations, comparisonNumber, formatComparisonValue, formatComparisonRatio, exactComparisonValue, comparisonReason, exportTaskComparison, healthDifferences, taskComparisonRows, verdictLabel } from '../../core/task-comparison.js';
import type { ComparisonRow } from '../../core/task-comparison.js';
import { readRecentComparisons, rememberComparison, serializeComparisonRoute, parseTaskRoute } from '../../task-route.js';
import type { TaskRoute } from '../../task-route.js';
import { api, fetchJson } from '../../api/client.js';
import { useTaskRead } from './task-data.js';
import { architectureApi, downloadArchitecture } from '../agent-folding/architecture-client.js';
import { ArchitectureReadError } from '../agent-folding/ArchitectureReadError.js';
import { ImportedArchitectureCompare } from '../agent-folding/ArchitectureCompare.js';
import { CompareRunEvidence } from '../CompareRunEvidence.js';
import { CompareTimeline } from '../CompareTimeline.js';
import { CompareToolAnalysis } from '../CompareToolAnalysis.js';
import { healthApi } from './health/health-client.js';
import '../../styles/components/task-comparison.css';

export function ComparisonMetricTable({ rows, locale }: { rows: ComparisonRow[]; locale: Locale }) {
  const zh = locale === 'zh';
  const stats = (stats: ComparisonRow['a'], unit:string,key:string) => <Tooltip label={`n=${comparisonNumber(stats.n)} · ${zh?'均值':'Mean'} ${formatComparisonValue(stats.mean,unit,locale)} · ${formatComparisonValue(stats.min,unit,locale)}–${formatComparisonValue(stats.max,unit,locale)} · CV ${formatComparisonValue(stats.cv,'%',locale)}`}><span tabIndex={0} title={exactComparisonValue(stats.median,unit)}>{key==='tokens'?formatTokens(stats.median):formatComparisonValue(stats.median,unit,locale)}</span></Tooltip>;
  const table = (items: ComparisonRow[]) => <div className="task-compare-table"><table className="ui-table ui-table-compact comparison-metric-table"><thead><tr><th>{zh ? '指标 / 单位' : 'Metric / unit'}</th><th>A · {zh ? '基线' : 'Baseline'}</th><th>B · {zh ? '改进' : 'Improvement'}</th><th>B − A</th><th>B/A</th><th>{zh ? '判断' : 'Assessment'}</th></tr></thead><tbody>{items.map(r => <tr key={r.key}><th>{r.label}</th><td>{stats(r.a,r.unit,r.key)}</td><td>{stats(r.b,r.unit,r.key)}</td><td title={exactComparisonValue(r.delta,r.unit)}>{r.key==='tokens'&&r.delta!==null?(r.delta>0?'+':'')+formatTokens(r.delta):formatComparisonValue(r.delta,r.unit,locale,true)}</td><td title={exactComparisonValue(r.ratio)}>{formatComparisonRatio(r.ratio)}</td><td><Badge tone={r.verdict==='better'?'success':r.verdict==='worse'?'danger':'neutral'}>{verdictLabel(r.verdict, locale)}</Badge>{r.reason && <Tooltip label={comparisonReason(r.reason,locale)}><span tabIndex={0}> ⓘ</span></Tooltip>}</td></tr>)}</tbody></table></div>;
  const unknown = rows.filter(r => r.a.median === null && r.b.median === null);
  return <>{table(rows.filter(r => r.a.median !== null || r.b.median !== null))}{unknown.length > 0 && <div className="task-compare-unknown"><Accordion title={`${zh?'未知指标':'Unknown metrics'}（${unknown.length}）`}>{table(unknown)}</Accordion></div>}</>;
}
export function ComparisonProcess({ a, b, locale, scope, requestA,requestB,onLocate,onResult }: {onResult?:(result:CompareResult|null,timeline:CompareResult|null)=>void; requestA?:string;requestB?:string; a: TaskSummary | undefined; b: TaskSummary | undefined; locale: Locale; scope: string; onLocate: (task:string,event?:string,request?:string)=>void }) {
  const zh = locale === 'zh';
  const [showSystem,setShowSystem]=useState(false);
  const left = a?.rootSessionKey, right = b?.rootSessionKey;
  const read = useCallback((signal: AbortSignal) => api.compare(left!, right!, signal,{leftRequest:requestA,rightRequest:requestB}), [left, right,requestA,requestB]);
  const result = useTaskRead(left && right && (left !== right||Boolean(requestA&&requestB&&requestA!==requestB)) ? JSON.stringify([left, right, scope]) : null, read, 10000);
  const timelineResult=useMemo(()=>{
    if(!result.value||showSystem)return result.value;
    return {...result.value,left:{...result.value.left,events:result.value.left.events.filter(e=>!isSystemRecord(e))},right:{...result.value.right,events:result.value.right.events.filter(e=>!isSystemRecord(e))}};
  },[result.value,showSystem]);
  useEffect(()=>{onResult?.(result.value,timelineResult);},[result.value,timelineResult,onResult]);
  return <div className="compare-process-body">
    <Accordion title={zh?'计算口径':'Calculation basis'}><p>{zh?'仅所选根会话已加载页；工具耗时为记录区间，不代表实测执行。':'Selected root-session loaded pages only; tool durations are recorded intervals, not measured execution.'}</p>{(requestA||requestB)&&<p>{zh?'请求窗口 · 仅主会话已加载页':'Request window · loaded root-session page only'}</p>}</Accordion>
    {!left||!right?<EmptyState icon={<IconCompare/>} title={zh?'过程对照不可用':'Process comparison unavailable'} description={zh?'导入任务或主会话缺失。':'Imported tasks or missing root sessions.'}/>:null}
    {result.loading&&<PageSkeleton compact variant="table"/>}
    {result.error&&<ArchitectureReadError error={result.errorInfo??result.error} locale={locale} retry={result.retry}/>}
    {result.value&&<><div className="compare-process-toolbar"><Pill>A · {timelineResult!.left.events.length}/{result.value.left.eventTotal}</Pill><Pill>B · {timelineResult!.right.events.length}/{result.value.right.eventTotal}</Pill><Checkbox checked={showSystem} onChange={e=>setShowSystem(e.target.checked)} label={zh?'显示系统记录':'Show system records'}/></div>
    <Accordion title={zh?'调查入口':'Investigation entries'}><CompareRunEvidence result={result.value} locale={locale} onOpenRun={(key,event)=>{const isRight=key!==left||left===right&&Boolean(event&&result.value!.right.events.some(e=>e.id===event));onLocate(isRight?b!.id:a!.id,event?key+':event:'+event:undefined,isRight?requestB:requestA);}}/></Accordion>
    <CompareTimeline result={timelineResult!} locale={locale}/><h3>{zh?'工具使用差异':'Tool usage differences'}</h3><div className="task-compare-table"><CompareToolAnalysis result={result.value} locale={locale} maxTools={null}/></div></>}
  </div>;

}
export function TaskComparison({ route, onRoute, locale, onLocate, invalidateKey = 0, onMenu, onSearch }: {onMenu?:()=>void;onSearch?:()=>void; route: TaskRoute; onRoute: (route: TaskRoute) => void; locale: Locale; onLocate: (task: string, event?: string,request?:string) => void; invalidateKey?: number }) {
  const zh = locale === 'zh', a = route.compareA ?? [], b = route.compareB ?? [], valid = a.length > 0 && b.length > 0;
  const definition = serializeComparisonRoute(route), groups = JSON.stringify([a, b, route.requestA,route.requestB,invalidateKey]);
  const [recent, setRecent] = useState(readRecentComparisons);
  useEffect(() => { rememberComparison(route); setRecent(readRecentComparisons()); }, [definition]); // URL defines history, never the reverse.
  const read = useCallback(async(signal: AbortSignal) => {
    const result=await fetchJson<TaskComparisonSnapshot>('/task-comparison', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a, b,...(route.requestA?{ar:route.requestA}:{}),...(route.requestB?{br:route.requestB}:{}) }), signal });
    if(!result||!Array.isArray(result.a)||!Array.isArray(result.b)||result.a.length!==a.length||result.b.length!==b.length||[...result.a,...result.b].some(t=>typeof t.id!=='string'||!['collected','imported'].includes(t.origin)))throw new Error('INVALID_COMPARISON');
    return result;
  }, [groups]);
  const snapshot = useTaskRead(valid ? groups : null, read, 35000);
  const canonicalA = snapshot.value?.a.map(t => t.id), canonicalB = snapshot.value?.b.map(t => t.id);
  useEffect(() => { if (canonicalA && canonicalB && JSON.stringify([canonicalA, canonicalB]) !== JSON.stringify([a, b])) onRoute({ ...route, compareA: canonicalA, compareB: canonicalB }); }, [snapshot.value,route.requestA,route.requestB]);
  const native = valid && !route.requestA&&!route.requestB && [...a, ...b].every(id => id.startsWith('collected:'));
  const readArchitecture = useCallback((signal: AbortSignal) => architectureApi.compare(a, b, signal), [groups]);
  const architecture = useTaskRead(native ? groups : null, readArchitecture, 35000);
  const processScope=JSON.stringify([groups,route.processA,route.processB]);
  const [processSnapshot,setProcessSnapshot]=useState<{scope:string;value:CompareResult;tools:CompareResult}|null>(null);
  const receiveProcess=useCallback((tools:CompareResult|null,value:CompareResult|null)=>setProcessSnapshot(value&&tools?{scope:processScope,value,tools}:null),[processScope]);
  const [healthProgress,setHealthProgress]=useState({scope:'',done:0,total:0});
  const [healthScope, setHealthScope] = useState<string | null>(null);
  const readHealth = useCallback(async (signal: AbortSignal) => {
    const result: { a: HealthReport[]; b: HealthReport[] } = { a: [], b: [] };
    // The standard API owns exact revision/scope/threshold/version reuse. Sequential
    // calls respect its single-job guard and never create a deep/model request.
    setHealthProgress({scope:groups,done:0,total:a.length+b.length});
    for (const side of ['a', 'b'] as const) for (const [index,task] of snapshot.value![side].entries()) { signal.throwIfAborted(); result[side].push(await healthApi.generate(task.id, { member: 'all', from: null, to: null,...(index===0&&(side==='a'?route.requestA:route.requestB)?{request:(side==='a'?route.requestA:route.requestB)}:{}) }, signal)); if(!signal.aborted)setHealthProgress(p=>({...p,done:p.done+1})); }
    return result;
  }, [snapshot.value,route.requestA,route.requestB]);
  const health = useTaskRead(healthScope === groups && snapshot.value ? groups : null, readHealth, 120000);
  const rows = useMemo(() => snapshot.value ? taskComparisonRows(snapshot.value, architecture.value, health.value, locale) : [], [snapshot.value, architecture.value, health.value, locale]);
  const differences = useMemo(() => health.value ? healthDifferences(health.value.a, health.value.b) : null, [health.value]);
  const confounded = snapshot.value ? comparisonConfounded(snapshot.value, architecture.value) : false;
  const limitations = comparisonLimitations(locale, a.length === 1 || b.length === 1 || rows.some(r=>r.a.n===1||r.b.n===1), confounded);
  const processA = snapshot.value?.a.find(t => t.id === route.processA) ?? snapshot.value?.a[0], processB = snapshot.value?.b.find(t => t.id === route.processB) ?? snapshot.value?.b[0];
  const [recentOpen,setRecentOpen]=useState(false),[exportOpen,setExportOpen]=useState(false);
  useEffect(()=>{setRecentOpen(false);setExportOpen(false);},[definition]);
  const verdictOrder=['duration','tokens','cacheHitRate','errors','toolFailure','toolCalls','subAgents','health'];
  const display=(r:ComparisonRow,value:number|null)=>r.key==='tokens'?formatTokens(value):r.unit==='ms'?formatDuration(value,locale):r.unit==='%'?formatPercent(value===null?null:value/100):formatComparisonValue(value,r.unit,locale);
  return <article className="task-comparison"><PageHeader title={zh?'对比':'Compare'} description={zh?'比较优化前后的执行差异':'Compare execution before and after changes'} locale={locale} onMenu={onMenu} onSearch={onSearch} actions={<>
    <DropdownMenu open={recentOpen} onOpenChange={setRecentOpen} trigger={props=><Button {...props}>{zh?'最近对比':'Recent comparisons'}</Button>} items={recent.length?recent.map((hash,i)=>({id:hash,label:`${i+1} · A ${parseTaskRoute(hash).compareA?.length??0} → B ${parseTaskRoute(hash).compareB?.length??0}`,onSelect:()=>{window.location.hash=hash;}})):[{id:'empty',label:zh?'暂无历史':'No recent comparisons',disabled:true}]}/>
    <DropdownMenu open={exportOpen} onOpenChange={setExportOpen} trigger={props=><Button {...props} icon={<IconDownload/>} disabled={!snapshot.value}>{zh?'导出':'Export'}</Button>} items={(['md','html'] as const).map(format=>({id:format,label:format==='md'?'Markdown':'HTML',onSelect:()=>{if(snapshot.value)downloadArchitecture('task-comparison.'+format,exportTaskComparison(rows,differences,limitations,locale,format,window.location.href,snapshot.value,comparisonExportLines(snapshot.value,locale,processSnapshot?.scope===processScope?processSnapshot.value:null,architecture.value,processSnapshot?.scope===processScope?processSnapshot.tools:null)),format==='html'?'text/html':'text/markdown');}}))}/>
  </>}/><div className="task-compare-content">
    <div className="task-compare-selection"><CompareTaskPicker closeKey={definition} side="A" locale={locale} ids={a} other={b} selected={snapshot.value?.a??[]} request={route.requestA} onRequest={requestA=>onRoute({...route,requestA})} onChange={ids=>onRoute({...route,compareA:ids,processA:undefined,requestA:undefined})}/>
    <IconButton label={zh?'交换':'Swap'} icon={<IconCompare/>} onClick={()=>onRoute({...route,compareA:b,compareB:a,requestA:route.requestB,requestB:route.requestA,processA:route.processB,processB:route.processA})}/>
    <CompareTaskPicker closeKey={definition} side="B" locale={locale} ids={b} other={a} selected={snapshot.value?.b??[]} request={route.requestB} onRequest={requestB=>onRoute({...route,requestB})} onChange={ids=>onRoute({...route,compareB:ids,processB:undefined,requestB:undefined})}/></div>
    {a.length===1&&route.requestA&&<CompareRequestPicker taskId={a[0]} exclude={route.requestA} label={zh?'同任务 B':'B in same task'} locale={locale} onSelect={request=>{if(request)onRoute({...route,compareB:[a[0]!],requestB:request,processB:undefined});}}/>}
    {!valid&&<EmptyState icon={<IconCompare/>} title={zh?'选择基线和改进任务开始对比':'Choose baseline and improvement tasks to compare'} description={zh?'每侧选择 1–40 个任务，优先选择相同工具。':'Choose 1–40 tasks per side, preferably from the same tool.'}/>}
    {route.compareImport && <ImportedArchitectureCompare locale={locale} onLocate={onLocate} onClose={() => onRoute({ ...route, compareImport: undefined })} />}
    {snapshot.loading && <PageSkeleton />}
    {snapshot.error && <ArchitectureReadError error={snapshot.errorInfo ?? snapshot.error} locale={locale} retry={snapshot.retry} />}
    {snapshot.value && <><section><h2>{zh?'结论':'Conclusions'}</h2>
      <Callout title={limitations.find(line=>line.includes(zh?'单样本':'Single sample'))??limitations[0]!} tone="attention">{confounded?(zh?'混杂：跨工具或多个配置变化':'Confounded: different tools or multiple configuration changes'):null}</Callout>
      <div className="task-compare-conclusions">{rows.filter(r=>r.key!=='delegations').sort((a,b)=>verdictOrder.indexOf(a.key)-verdictOrder.indexOf(b.key)).map(r=><VerdictCard key={r.key} label={r.label} a={display(r,r.a.median)} b={display(r,r.b.median)} aExact={exactComparisonValue(r.a.median,r.unit)} bExact={exactComparisonValue(r.b.median,r.unit)} verdict={r.verdict} assessment={verdictLabel(r.verdict,locale)} change={r.ratio!==null?`${r.ratio<1?'▼':r.ratio>1?'▲':''} ${formatPercent(Math.abs(r.ratio-1))}`:undefined} reason={r.reason?comparisonReason(r.reason,locale):undefined}/>)}</div>
      <Accordion title={zh?'计算口径与限制':'Conventions and limitations'}>{limitations.map(line=><p key={line}>{line}</p>)}</Accordion>
    </section>
    <Card><CardHeader title={zh?'指标明细':'Metric details'}/><CardBody><ComparisonMetricTable rows={rows} locale={locale}/>{architecture.loading&&<PageSkeleton compact variant="table"/>}{architecture.error&&<ArchitectureReadError error={architecture.errorInfo??architecture.error} locale={locale} retry={architecture.retry}/>}</CardBody></Card>
    <CompareTaskTokens snapshot={snapshot.value} runs={architecture.value} locale={locale}/>
    <CompareHealthDifferences locale={locale} differences={differences} reports={health.value} loading={health.loading} progress={healthProgress.scope===groups?healthProgress:undefined} error={health.errorInfo??health.error} onGenerate={()=>{setHealthScope(groups);health.retry();}} onCancel={()=>setHealthScope(null)} onLocate={onLocate}/>
      <Card><CardHeader title={zh?'过程对照':'Process comparison'}/><CardBody><div className="task-compare-selectors">{(['a','b'] as const).map(side=><Select locale={locale} prefix={side.toUpperCase()} closeKey={definition} key={side} aria-label={side.toUpperCase()+' '+(zh?'过程任务':'Process task')} value={(side==='a'?processA:processB)?.id??''} options={snapshot.value![side].map(t=>({value:t.id,label:t.title||t.id}))} onChange={e=>onRoute({...route,[side==='a'?'processA':'processB']:e.target.value})}/>)}</div>
      <ComparisonProcess onResult={receiveProcess} a={processA} b={processB} requestA={processA?.id===a[0]?route.requestA:undefined} requestB={processB?.id===b[0]?route.requestB:undefined} locale={locale} scope={processScope} onLocate={onLocate} />
      </CardBody></Card>
    </>}
  </div></article>;
}
