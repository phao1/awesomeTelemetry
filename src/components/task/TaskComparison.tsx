import { RequestPicker } from './TaskRequests.js';
import { isSystemRecord } from '../../core/system-records.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../i18n.js';
import { formatTaskCosts } from '../../core/task-alerts.js';
import type { TaskComparisonSnapshot, TaskSummary } from '../../core/task-types.js';
import type { HealthReport } from '../../core/task-health/types.js';
import { comparisonConfounded, comparisonLimitations, comparisonNumber, formatComparisonValue, formatComparisonRatio, exactComparisonValue, comparisonReason, exportTaskComparison, healthDifferences, healthRuleCounts, taskComparisonRows, verdictLabel } from '../../core/task-comparison.js';
import type { ComparisonRow } from '../../core/task-comparison.js';
import { readRecentComparisons, rememberComparison, serializeComparisonRoute } from '../../task-route.js';
import type { TaskRoute } from '../../task-route.js';
import { api, fetchJson } from '../../api/client.js';
import { taskApi, useTaskRead } from './task-data.js';
import { architectureApi, downloadArchitecture } from '../agent-folding/architecture-client.js';
import { ArchitectureReadError } from '../agent-folding/ArchitectureReadError.js';
import { ImportedArchitectureCompare } from '../agent-folding/ArchitectureCompare.js';
import { CompareRunEvidence } from '../CompareRunEvidence.js';
import { CompareTimeline } from '../CompareTimeline.js';
import { CompareToolAnalysis } from '../CompareToolAnalysis.js';
import { CompareTokenUsage } from '../CompareTokenUsage.js';
import { healthApi } from './health/health-client.js';
import { healthProse } from './health/health-copy.js';
import '../../styles/components/task-comparison.css';

function TaskGroupPicker({ side, ids, other, selected, locale, onChange }: { side: 'A' | 'B'; ids: string[]; other: string[]; selected: TaskSummary[]; locale: Locale; onChange: (ids: string[]) => void }) {
  const zh = locale === 'zh', name = side === 'A' ? (zh ? '基线' : 'Baseline') : (zh ? '改进' : 'Improvement');
  const [query, setQuery] = useState(''), [origin, setOrigin] = useState<'collected' | 'imported'>('collected'), [offset, setOffset] = useState(0), [search, setSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setOffset(0); }, 250); return () => clearTimeout(timer); }, [query]);
  const read = useCallback((signal: AbortSignal) => taskApi.list({ q: search, origin, offset, limit: 50, summary: true }, signal), [search, origin, offset]);
  const tasks = useTaskRead(JSON.stringify([search, origin, offset]), read, 10000);
  return <fieldset className="task-compare-picker"><legend>{side} · {name} ({ids.length}/40)</legend>
    <input aria-label={`${name} ${zh ? '搜索任务' : 'search tasks'}`} value={query} onChange={e => setQuery(e.target.value)} placeholder={zh ? '搜索任务标题或 ID' : 'Search task title or ID'} />
    <select aria-label={`${name} ${zh ? '来源' : 'origin'}`} value={origin} onChange={e => { setOrigin(e.target.value as typeof origin); setOffset(0); }}><option value="collected">{zh ? '本地任务' : 'Collected tasks'}</option><option value="imported">{zh ? '导入任务' : 'Imported tasks'}</option></select>
    <ul className="task-compare-selected">{ids.map(id => <li key={id}><span>{selected.find(t => t.id === id)?.title || id}<small> · {zh?'费用：':'Cost: '}{formatTaskCosts(selected.find(t=>t.id===id)?.metrics,zh)}{selected.find(t=>t.id===id)?.metrics?.costs?.amounts.map(amount=>` · ${amount.source}`).join('')}</small></span><button className="btn" aria-label={`${zh ? '移除' : 'Remove'} ${id}`} onClick={() => onChange(ids.filter(x => x !== id))}>×</button></li>)}</ul>
    <details><summary>{zh ? '选择任务' : 'Choose tasks'}</summary>
      {tasks.loading && <p role="status">{zh ? '读取任务…' : 'Reading tasks…'}</p>}
      {tasks.error && <ArchitectureReadError error={tasks.errorInfo ?? tasks.error} locale={locale} retry={tasks.retry} />}
      <div className="task-compare-options">{tasks.value?.items.map(task => <label key={task.id}><input type="checkbox" checked={ids.includes(task.id)} disabled={other.includes(task.id) || !ids.includes(task.id) && ids.length >= 40} onChange={() => onChange(ids.includes(task.id) ? ids.filter(id => id !== task.id) : [...ids, task.id])} /><span>{task.title || task.id} · {task.provider}</span></label>)}</div>
      {tasks.value?.items.length === 0 && <p>{zh ? '没有匹配任务，请调整搜索或来源。' : 'No matching tasks. Change search or origin.'}</p>}
      <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>←</button><span>{offset + 1}–{offset + (tasks.value?.items.length ?? 0)}</span><button className="btn" disabled={!tasks.value?.hasMore} onClick={() => setOffset(offset + 50)}>→</button>
    </details>
  </fieldset>;
}
export function ComparisonMetricTable({ rows, locale }: { rows: ComparisonRow[]; locale: Locale }) {
  const zh = locale === 'zh';
  const stats = (stats: ComparisonRow['a'], unit:string) => <details><summary title={exactComparisonValue(stats.median,unit)}>{formatComparisonValue(stats.median,unit,locale)}</summary><span>n={comparisonNumber(stats.n)} · {zh ? '均值' : 'Mean'} <span title={exactComparisonValue(stats.mean,unit)}>{formatComparisonValue(stats.mean,unit,locale)}</span> · <span title={`${exactComparisonValue(stats.min,unit)}–${exactComparisonValue(stats.max,unit)}`}>{formatComparisonValue(stats.min,unit,locale)}–{formatComparisonValue(stats.max,unit,locale)}</span> · CV <span title={exactComparisonValue(stats.cv,'%')}>{formatComparisonValue(stats.cv,'%',locale)}</span></span></details>;
  const table = (items: ComparisonRow[]) => <div className="task-compare-table"><table className="ui-table ui-table-compact"><thead><tr><th>{zh ? '指标 / 单位' : 'Metric / unit'}</th><th>A · {zh ? '基线' : 'Baseline'}</th><th>B · {zh ? '改进' : 'Improvement'}</th><th>B − A</th><th>B/A</th><th>{zh ? '判断' : 'Assessment'}</th></tr></thead><tbody>{items.map(r => <tr key={r.key}><th>{r.label}</th><td>{stats(r.a,r.unit)}</td><td>{stats(r.b,r.unit)}</td><td title={exactComparisonValue(r.delta,r.unit)}>{formatComparisonValue(r.delta,r.unit,locale,true)}</td><td title={exactComparisonValue(r.ratio)}>{formatComparisonRatio(r.ratio)}</td><td>{verdictLabel(r.verdict, locale)}{r.reason && <small> · {comparisonReason(r.reason, locale)}</small>}</td></tr>)}</tbody></table></div>;
  const unknown = rows.filter(r => r.a.median === null && r.b.median === null);
  return <>{table(rows.filter(r => r.a.median !== null || r.b.median !== null))}{unknown.length > 0 && <details className="task-compare-unknown"><summary>{zh ? '未知指标' : 'Unknown metrics'}（{unknown.length}）</summary>{table(unknown)}</details>}</>;
}
export function ComparisonProcess({ a, b, locale, scope, requestA,requestB,onLocate }: { requestA?:string;requestB?:string; a: TaskSummary | undefined; b: TaskSummary | undefined; locale: Locale; scope: string; onLocate: (task:string,event?:string,request?:string)=>void }) {
  const zh = locale === 'zh';
  const [showSystem,setShowSystem]=useState(false);
  const left = a?.rootSessionKey, right = b?.rootSessionKey;
  const read = useCallback((signal: AbortSignal) => api.compare(left!, right!, signal,{leftRequest:requestA,rightRequest:requestB}), [left, right,requestA,requestB]);
  const result = useTaskRead(left && right && (left !== right||Boolean(requestA&&requestB&&requestA!==requestB)) ? JSON.stringify([left, right, scope]) : null, read, 10000);
  const timelineResult=useMemo(()=>{
    if(!result.value||showSystem)return result.value;
    return {...result.value,left:{...result.value.left,events:result.value.left.events.filter(e=>!isSystemRecord(e))},right:{...result.value.right,events:result.value.right.events.filter(e=>!isSystemRecord(e))}};
  },[result.value,showSystem]);
  return <section>{(requestA||requestB)&&<p>{zh?'请求窗口 · 仅主会话已加载页':'Request window · loaded root-session page only'}</p>}<h2>{zh ? '过程对照' : 'Process comparison'}</h2><p>{zh ? 'A = L（基线），B = R（改进）。仅展示所选两个任务的主会话、已加载事件页；工具平均耗时是记录区间，不代表实测执行。' : 'A = L (baseline), B = R (improvement). Selected root sessions and loaded event pages only. Tool averages are recorded intervals, not measured execution.'}</p>
    {!left || !right ? <p>{zh ? '导入任务或缺少主会话时，过程对照不可用。' : 'Process comparison is unavailable for imports or missing root sessions.'}</p> : null}
    {result.loading && <p role="status">{zh ? '读取过程…' : 'Reading process…'}</p>}
    {result.error && <ArchitectureReadError error={result.errorInfo ?? result.error} locale={locale} retry={result.retry} />}
    {result.value && <><p>{zh ? '已加载事件' : 'Loaded events'}: A {result.value.left.events.length}/{result.value.left.eventTotal} · B {result.value.right.events.length}/{result.value.right.eventTotal}</p><CompareRunEvidence result={result.value} locale={locale} onOpenRun={(key,event)=>{const isRight=key!==left||left===right&&Boolean(event&&result.value!.right.events.some(e=>e.id===event));onLocate(isRight?b!.id:a!.id,event?key+':event:'+event:undefined,isRight?requestB:requestA);}} /><label><input type="checkbox" checked={showSystem} onChange={e=>setShowSystem(e.target.checked)} />{zh?'显示系统记录':'Show system records'}</label><p>{zh?'时间线显示':'Timeline showing'}: A {timelineResult!.left.events.length} / {result.value.left.events.length} · B {timelineResult!.right.events.length} / {result.value.right.events.length}</p><CompareTimeline result={timelineResult!} locale={locale} /><h3>{zh ? '工具使用差异' : 'Tool usage differences'}</h3><div className="task-compare-table"><CompareToolAnalysis result={result.value} locale={locale} maxTools={null} /></div>{!requestA&&!requestB&&<><h3>Token</h3><div className="task-compare-table"><CompareTokenUsage usage={{ left: result.value.left.session.tokenUsage, right: result.value.right.session.tokenUsage }} estimates={{ left: null, right: null }} locale={locale} /></div></>}</>}
  </section>;
}
export function TaskComparison({ route, onRoute, locale, onLocate, invalidateKey = 0 }: { route: TaskRoute; onRoute: (route: TaskRoute) => void; locale: Locale; onLocate: (task: string, event?: string,request?:string) => void; invalidateKey?: number }) {
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
  const [healthScope, setHealthScope] = useState<string | null>(null);
  const readHealth = useCallback(async (signal: AbortSignal) => {
    const result: { a: HealthReport[]; b: HealthReport[] } = { a: [], b: [] };
    // The standard API owns exact revision/scope/threshold/version reuse. Sequential
    // calls respect its single-job guard and never create a deep/model request.
    for (const side of ['a', 'b'] as const) for (const [index,task] of snapshot.value![side].entries()) { signal.throwIfAborted(); result[side].push(await healthApi.generate(task.id, { member: 'all', from: null, to: null,...(index===0&&(side==='a'?route.requestA:route.requestB)?{request:(side==='a'?route.requestA:route.requestB)}:{}) }, signal)); }
    return result;
  }, [snapshot.value,route.requestA,route.requestB]);
  const health = useTaskRead(healthScope === groups && snapshot.value ? groups : null, readHealth, 120000);
  const rows = useMemo(() => snapshot.value ? taskComparisonRows(snapshot.value, architecture.value, health.value, locale) : [], [snapshot.value, architecture.value, health.value, locale]);
  const differences = useMemo(() => health.value ? healthDifferences(health.value.a, health.value.b) : null, [health.value]);
  const confounded = snapshot.value ? comparisonConfounded(snapshot.value, architecture.value) : false;
  const limitations = comparisonLimitations(locale, a.length === 1 || b.length === 1 || rows.some(r=>r.a.n===1||r.b.n===1), confounded);
  const processA = snapshot.value?.a.find(t => t.id === route.processA) ?? snapshot.value?.a[0], processB = snapshot.value?.b.find(t => t.id === route.processB) ?? snapshot.value?.b[0];
  return <article className="task-comparison"><h1>{zh ? '优化前后对比' : 'Before / after comparison'}</h1>
    <div className="task-compare-selectors">{(['A', 'B'] as const).map(side => <TaskGroupPicker key={side} side={side} locale={locale} ids={side === 'A' ? a : b} other={side === 'A' ? b : a} selected={snapshot.value?.[side === 'A' ? 'a' : 'b'] ?? []} onChange={ids => onRoute({ ...route, [side === 'A' ? 'compareA' : 'compareB']: ids, processA: undefined, processB: undefined,requestA:undefined,requestB:undefined })} />)}</div>
    <div className="task-compare-selectors">{(['a','b'] as const).map(side=><RequestPicker key={side} taskId={(side==='a'?a:b)[0]} value={side==='a'?route.requestA:route.requestB} label={side.toUpperCase()} locale={locale} onSelect={request=>onRoute({...route,[side==='a'?'requestA':'requestB']:request})}/>)}</div>
    {a.length===1&&route.requestA&&<RequestPicker taskId={a[0]} exclude={route.requestA} label={zh?'同任务 B':'B in same task'} locale={locale} onSelect={request=>{if(request)onRoute({...route,compareB:[a[0]!],requestB:request,processB:undefined});}}/>}
    {recent.length > 0 && <details><summary>{zh ? '最近对比' : 'Recent comparisons'}</summary><ul>{recent.map(hash => <li key={hash}><a href={hash}>{hash}</a></li>)}</ul></details>}
    {!valid && <p>{zh ? '请为基线与改进各选择 1–40 个任务；两组不可重复。优先选择相同工具/provider。' : 'Choose 1–40 distinct tasks for baseline and improvement. Prefer the same tool/provider.'}</p>}
    {route.compareImport && <ImportedArchitectureCompare locale={locale} onLocate={onLocate} onClose={() => onRoute({ ...route, compareImport: undefined })} />}
    {snapshot.loading && <p role="status">{zh ? '正在读取任务摘要…' : 'Reading task summaries…'}</p>}
    {snapshot.error && <ArchitectureReadError error={snapshot.errorInfo ?? snapshot.error} locale={locale} retry={snapshot.retry} />}
    {snapshot.value && <><section><h2>{zh ? '结论' : 'Conclusions'}</h2><div className="task-compare-conclusions">{rows.filter(r => !['costCNY', 'costUSD'].includes(r.key) || r.a.median !== null || r.b.median !== null).map(r => <p key={r.key} data-verdict={r.verdict}><strong>{r.label} · {verdictLabel(r.verdict, locale)}</strong><span><span title={exactComparisonValue(r.delta,r.unit)}>B − A {formatComparisonValue(r.delta,r.unit,locale,true)}</span> · <span title={exactComparisonValue(r.ratio)}>B/A {formatComparisonRatio(r.ratio)}</span></span>{r.reason && <small>{comparisonReason(r.reason, locale)}</small>}</p>)}</div>{rows.filter(r=>r.key.startsWith('cost')).every(r=>r.a.median===null&&r.b.median===null)&&<p><strong>{zh?'费用 · 不可比':'Cost · Not comparable'}</strong> · B − A — · B/A —<small> · {comparisonReason('cost',locale)}</small></p>}{limitations.map(line => <p key={line}>{line}</p>)}</section>
      <section><h2>{zh ? '指标' : 'Metrics'}</h2><ComparisonMetricTable rows={rows} locale={locale} />
        {architecture.loading && <p role="status">{zh ? '读取架构与 Token 口径…' : 'Reading architecture and token conventions…'}</p>}
        {architecture.error && <ArchitectureReadError error={architecture.errorInfo ?? architecture.error} locale={locale} retry={architecture.retry} />}
      </section>
      <section><h2>{zh ? '健康报告差异' : 'Health report differences'}</h2><button className="btn" disabled={health.loading} onClick={() => { setHealthScope(groups); health.retry(); }}>{zh ? '为两侧生成/读取标准健康报告' : 'Generate / read standard health reports for both sides'}</button>
        <p>{zh ? '同修订、范围与阈值的报告直接复用。只读标准报告，不调用模型；证据不完整时不宣称问题已消失。' : 'Reports with matching revisions, scopes and thresholds are reused. Standard reports only, no model request; incomplete evidence cannot certify resolution.'}</p>
        {health.loading && <p role="status">{zh ? '顺序读取两侧健康报告…' : 'Reading both groups sequentially…'}<button className="btn" onClick={() => setHealthScope(null)}>{zh ? '取消' : 'Cancel'}</button></p>}
        {health.error && <ArchitectureReadError error={health.errorInfo ?? health.error} locale={locale} retry={health.retry} />}
        {health.value && <><details><summary>{zh?'报告口径与修订':'Report conventions and revisions'}</summary>{[...health.value.a,...health.value.b].map(r=><p key={r.id}>{r.taskId} · {r.generatedAt} · {r.thresholds.profile} · calc {r.calcVersion} / rules {r.ruleVersion} · revision {r.revision} · {r.coverage.members.loaded}/{r.coverage.members.total}</p>)}</details><div className="task-compare-table"><table className="ui-table"><thead><tr><th>{zh ? '规则' : 'Rule'}</th><th>A</th><th>B</th></tr></thead><tbody>{[...new Set([...health.value.a, ...health.value.b].flatMap(r => r.findings.map(f => f.rule)))].map(rule => <tr key={rule}><th>{rule}</th>{(['a', 'b'] as const).map(side => { const count = healthRuleCounts(health.value![side], rule); return <td key={side}>{count.count}/{count.total} ({formatComparisonValue(count.ratio === null ? null : count.ratio * 100,'%',locale)})</td>; })}</tr>)}</tbody></table></div>
          {(['new', 'resolved', 'persisting', 'uncertain'] as const).map(status => <section key={status}><h3>{(zh ? { new: 'B 新出现的问题', resolved: '已消失的问题', persisting: '仍存在的问题', uncertain: '证据不足，无法判定新增或消失' } : { new: 'New in B', resolved: 'Resolved', persisting: 'Persisting', uncertain: 'Insufficient evidence for new / resolved' })[status]} ({differences!.filter(d => d.status === status).length})</h3>{differences!.filter(d => d.status === status).map(d => <details key={d.key}><summary>{d.rule} · A {new Set(d.a.map(o => o.report.taskId)).size}/{a.length} / B {new Set(d.b.map(o => o.report.taskId)).size}/{b.length}</summary>{[...d.a, ...d.b].map(o => <div key={o.report.id + o.finding.id}><p>{o.report.taskId} · {healthProse(o.finding.recommendation.action, locale)}</p>{o.finding.evidenceIds.map(id => { const e = o.report.evidence.find(e => e.id === id); return e ? e.recordIds.map(record => <button className="btn" key={id + record} onClick={() => onLocate(o.report.taskId, record,o.report.scope.request)}>{zh ? '轨迹证据' : 'Trace evidence'} · {e.title}</button>) : <p key={id}>{zh ? '证据不可用' : 'Evidence unavailable'}</p>; })}</div>)}</details>)}</section>)}
        </>}
      </section>
      <div className="task-compare-selectors">{(['a', 'b'] as const).map(side => <label key={side}>{side === 'a' ? 'A' : 'B'} · {zh ? '过程任务' : 'Process task'}<select value={(side === 'a' ? processA : processB)?.id ?? ''} onChange={e => onRoute({ ...route, [side === 'a' ? 'processA' : 'processB']: e.target.value })}>{snapshot.value![side].map(t => <option key={t.id} value={t.id}>{t.title || t.id}</option>)}</select></label>)}</div>
      <ComparisonProcess a={processA} b={processB} requestA={processA?.id===a[0]?route.requestA:undefined} requestB={processB?.id===b[0]?route.requestB:undefined} locale={locale} scope={groups} onLocate={onLocate} />
      <div className="architecture-toolbar">{(['md', 'html'] as const).map(format => <button className="btn" key={format} onClick={() => downloadArchitecture('task-comparison.' + format, exportTaskComparison(rows, differences, limitations, locale, format, window.location.href, snapshot.value!), format === 'html' ? 'text/html' : 'text/markdown')}>{zh ? '导出' : 'Export'} {format === 'md' ? 'Markdown' : 'HTML'}</button>)}</div>
    </>}
  </article>;
}
