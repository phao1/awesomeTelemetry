import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRsiConfig } from '../../core/rsi-validation.js';
import type { RsiTaskView, RsiOptions, RsiVerdict, RsiIterationMetric, RsiOverview } from '../../core/rsi-api-client.js';
import { RsiApiError } from '../../core/rsi-api-client.js';
import type { RsiIteration, RsiMonitorCalibration } from '../../core/rsi-types.js';
import { UiLocaleProvider } from '../ui/Locale.js';
import { RsiPage } from './RsiPage.js';
import { ActionDialog, approvalAllowed } from './Actions.js';
import { CalibrationReport, calibrationSufficient } from './Calibration.js';
import { CreateForm, OptimizerWarning } from './CreateTask.js';
import { IterationTable, TaskDetail } from './TaskDetail.js';
import { ScoreChart } from './Trend.js';
import { Verdicts, Findings, RunTable, IterationDetail } from './IterationDetail.js';
import { parseRsiRoute } from './route.js';
import { CursorPagination } from './Shared.js';
import { Reason } from './Shared.js';
import { traceSteps } from './Trajectory.js';
import { parseDiff } from './Diff.js';
const roots:Root[]=[];
function render(node:ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(<UiLocaleProvider locale="zh">{node}</UiLocaleProvider>));return {host,root};}
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.replaceChildren();vi.unstubAllGlobals();vi.useRealTimers();window.location.hash='';});
const at='2026-11-07T00:00:00.000Z';
const task:RsiTaskView={id:'task',repository:'/repo',baselineCommit:'a'.repeat(40),datasetHash:'b'.repeat(64),mainMetric:'passed_count',config:defaultRsiConfig(),state:'created',pauseReason:null,delta:null,baselineTrainScore:null,baselineSealedScore:null,sealedQueriesUsed:0,tokenUsage:0,iterationCount:0,monitorCalibration:null,currentParentId:null,createdAt:at,updatedAt:at};
const iteration:RsiIteration={id:'iteration',taskId:'task',seq:1,parentId:null,commit:'c'.repeat(40),prd:{observation:'one issue',hypothesis:'repair',changes:['a.ts'],expectedImpact:'more passes'},packageSha256:null,state:'held',holdReasons:['missing_monitor'],resumeState:'sealed',approvals:[],trainScore:null,sealedScore:null,createdAt:at,updatedAt:at};
const noOp=()=>undefined;
const props={locale:'zh' as const,onRefresh:noOp,overviewError:null,changes:{version:0,taskIds:[]}};
const options:RsiOptions={cli:{bin:'rsi',root:'/config',scripts:'/pkg/scripts'},agents:[{id:'mini-agent',name:'Mini',path:'/agent.json',description:null,family:null,egress:null,loginRequired:false,verified:true}],optimizers:[{id:'opencode-deepseek',name:'OpenCode',path:'/optimizer.json',description:null,family:'deepseek',egress:'model-proxy',loginRequired:false,verified:true}],bank:{path:'/bank',full:[],small:[]},defaults:defaultRsiConfig(),settings:{optimizerSessionTokens:2000000,optimizerSessionTimeoutMs:1800000,concurrency:3,allowUnmeteredOptimizer:false}};
function input(selector:string,value:string){const node=document.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector)!;act(()=>{Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});}
function click(text:string){const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);expect(button,text).toBeDefined();act(()=>button!.click());}
describe('complete RSI page states and human guards',()=>{
  it('uses a page skeleton during initial loading',()=>{const {host}=render(<RsiPage {...props} overview={null}/>);expect(host.querySelector('[aria-busy=true]')).not.toBeNull();expect(host.textContent).not.toContain('加载中...');});
  it('renders the real empty task state and creation action without native controls',()=>{const {host}=render(<RsiPage {...props} overview={{tasks:[],reviews:[],pendingCount:0}}/>);expect(host.textContent).toContain('还没有调优任务');expect(host.querySelector('select,details,input[type=file]')).toBeNull();expect(host.textContent).toContain('每一轮都经过评测和防作弊检查');});
  it('shows authentication errors and an explicit retry',()=>{const retry=vi.fn(),{host}=render(<RsiPage {...props} onRefresh={retry} overview={null} overviewError={new RsiApiError(403,'RSI_FORBIDDEN')}/>);expect(host.textContent).toContain('请刷新页面');click('重试');expect(retry).toHaveBeenCalledOnce();});
  it('renders an empty review queue through a deep link',()=>{window.location.hash='#/rsi?view=review';const {host}=render(<RsiPage {...props} overview={{tasks:[],reviews:[],pendingCount:0}}/>);expect(host.textContent).toContain('没有待处理的审查');expect(host.querySelector('[role=tab][aria-selected=true]')!.textContent).toContain('待审');});
  it('never permits approval of missing evidence even after a reason is entered',()=>{render(<ActionDialog action="approve" task={task} iteration={iteration} locale="zh" onClose={noOp} onSuccess={noOp}/>);input('textarea','checked evidence');expect([...document.querySelectorAll('button')].find(b=>b.textContent==='批准')!.disabled).toBe(true);expect(document.body.textContent).toContain('缺失证据不能批准');expect(approvalAllowed(iteration,['missing_monitor'],'because')).toBe(false);});
  it('requires every approvable category and a nonempty reason',()=>{const i={...iteration,holdReasons:['l3_suspicious','token_growth'] as RsiIteration['holdReasons']};expect(approvalAllowed(i,['l3_suspicious'],'checked')).toBe(false);expect(approvalAllowed(i,['l3_suspicious','token_growth'],' ')).toBe(false);expect(approvalAllowed(i,['l3_suspicious','token_growth'],'independent review')).toBe(true);});
  it('requires a rejection reason and disables repeated submissions while pending',async()=>{
    let finish:(value:Response)=>void=()=>undefined;const mutation=new Promise<Response>(resolve=>{finish=resolve;});
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async(url)=>String(url).endsWith('/session')?new Response(JSON.stringify({token:'page'})):mutation);vi.stubGlobal('fetch',fetcher);
    const success=vi.fn();render(<ActionDialog action="reject" task={task} iteration={iteration} locale="zh" onClose={noOp} onSuccess={success}/>);
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='拒绝')!;expect(button.disabled).toBe(true);input('textarea','reviewed');await act(async()=>{button.click();button.click();});expect(button.disabled).toBe(true);expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/commands'))).toHaveLength(1);
    await act(async()=>{finish(new Response(JSON.stringify({taskId:'task',queueId:'command',status:'queued'})));});expect(success).toHaveBeenCalledOnce();
  });
  it('marks every insufficient calibration stratum as reference, never passed',()=>{
    const report:RsiMonitorCalibration={version:1,family:'openai',model:'model',promptVersion:'v1',corpusHash:'d'.repeat(64),at,status:'insufficient',detectionMin:.8,falsePositiveMax:.1,minimumSamples:30,categories:['task_specific','hardcoded_answer','test_tampering','marker_deletion','rationalized_special_case','statement_keyed_heuristic','benign'].map(category=>({category:category as RsiMonitorCalibration['categories'][number]['category'],samples:5,valid:5,detected:category==='benign'?0:5,missing:0,rate:category==='benign'?0:1,interval:{lower:.5,upper:1}})),deterministic:[],message:'sample small'};
    const {host}=render(<CalibrationReport report={report} locale="zh"/>);expect(calibrationSufficient(report)).toBe(false);expect(host.textContent).toContain('样本不足，不能说明监控达标');expect(host.querySelector('.ui-badge-success')).toBeNull();expect(host.textContent).toContain('检出率（参考）');expect(calibrationSufficient({...report,status:'passed'})).toBe(false);
  });
  it('warns that vendor optimizers are untested and need explicit opt-in',()=>{const {host}=render(<OptimizerWarning locale="zh" id="codex" allow={false} onAllow={noOp}/>);expect(host.textContent).toContain('未实测');expect(host.textContent).toContain('用量无法硬限制');expect(host.querySelector('input[type=checkbox]')!.getAttribute('checked')).toBeNull();expect(host.querySelector('input[readonly]')!.getAttribute('value')).toContain('optimizer login --profile codex');});
  it('shows the task token once, clears it when opening the task and never persists it',async()=>{
    vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockImplementation(async url=>new Response(JSON.stringify(String(url).endsWith('/session')?{token:'page'}:{taskId:'task-new',queueId:'request',status:'queued',agentToken:'one-time-task-secret'}))));
    const open=vi.fn(),{root}=render(<CreateForm options={options} locale="zh" worker={null} onOpen={open} onCreated={noOp} onClose={noOp}/>);
    input('input[placeholder="/path/to/repository"]','/repo');const inputs=[...document.querySelectorAll<HTMLInputElement>('input')].filter(i=>!['hidden'].includes(i.type));const sha=inputs.find(i=>i.classList.contains('mono'))!;input('#'+sha.id,'a'.repeat(40));click('下一步');click('下一步');click('下一步');await act(async()=>click('创建任务'));
    expect(document.body.textContent).toContain('这个令牌只显示这一次');expect(document.querySelector('input[type=password]')!.getAttribute('value')).toBe('one-time-task-secret');expect(window.location.hash).not.toContain('one-time');expect(localStorage.getItem('one-time-task-secret')).toBeNull();click('打开任务');expect(open).toHaveBeenCalledWith('task-new');expect(document.querySelector('input[value="one-time-task-secret"]')).toBeNull();act(()=>root.render(<CreateForm options={options} locale="zh" worker={null} onOpen={open} onCreated={noOp} onClose={noOp}/>));expect(document.body.textContent).not.toContain('这个令牌只显示这一次');
  });
  it('unknown reasons are translated, with the original value in a keyboard tooltip',()=>{vi.useFakeTimers();const {host}=render(<Reason code="new-reason" locale="zh"/>);expect(host.textContent).toBe('未知原因 ⓘ');act(()=>host.querySelector<HTMLElement>('[tabindex]')!.focus());act(()=>vi.advanceTimersByTime(300));expect(document.querySelector('[role=tooltip]')!.textContent).toBe('new-reason');});
});
it('parses retained platform diffs with new-file line numbers',()=>{expect(parseDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+next\n')[0]).toEqual({file:'a.ts',rows:[{row:{kind:'ctx',text:'@@ -1 +1,2 @@'},line:null},{row:{kind:'del',text:'old'},line:null},{row:{kind:'add',text:'new'},line:1},{row:{kind:'add',text:'next'},line:2}]});});
it('uses observed request usage for trace steps and never fabricates message tokens',()=>{const text=JSON.stringify({requestId:'request',assistant:[{text:'done',tool_calls:[{function:{name:'edit',arguments:'{}'}}]}]});expect(traceSteps(text,'responses',true,[{requestId:'request',tokens:123,cacheHitRate:.5}])[0]).toMatchObject({role:'assistant',content:'done',tokens:123,cache:.5,tools:[{name:'edit',arguments:'{}'}]});expect(traceSteps('{"messages":[{"role":"user","content":"question"}]}','last-request',true)[0]!.tokens).toBeNull();});

const scored={...iteration,trainScore:3};
const metric:RsiIterationMetric={iteration:scored,iterationId:iteration.id,seq:1,adopted:null,targetTokens:1000,optimizerTokens:2000,reviewTokens:null,durationMs:100,cacheHitRate:null,reason:'review_usage_unavailable',defenses:[],finalState:'not_requested',session:null};
const verdict:RsiVerdict={approvedCategories:[],result:{verdict:'promote',conditions:(['anti_cheating','primary_metric','sealed','stable_regression','token_growth'] as const).map(condition=>({condition,verdict:'pass',reasons:[]}))},defenses:[],parentTrainScore:1,candidateTrainScore:3,parentSealedScore:1,candidateSealedScore:2,delta:.3,parentTokens:100,candidateTokens:120};
function json(body:unknown){return new Response(JSON.stringify(body));}
function fixtureReads(){
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>{
   const path=String(url).split('?')[0]!;
   if(path.endsWith('/session'))return json({token:'page'});
   if(path.endsWith('/options'))return json(options);
   if(path.endsWith('/metrics'))return json({iterations:[metric],helpReason:'Please help',pendingCommands:0,cacheHitRate:null,baselineProgress:null});
   if(path.endsWith('/iterations/1'))return json({iteration});
   if(path.endsWith('/verdict'))return json(verdict);
   if(path.endsWith('/diff'))return json({diff:'',quality:{changedLines:0,files:0},findings:[]});
   if(path.endsWith('/task'))return json({task:{...task,state:'needs_help'},head:null});
   return json({items:[],nextCursor:null});
 });vi.stubGlobal('fetch',fetcher);return fetcher;
}
describe('RSI browser review regressions',()=>{
 it('measures the score plot when data arrives after its empty state, and cleans up the observer',()=>{
   const observed:Element[]=[],disconnect=vi.fn();
   vi.stubGlobal('ResizeObserver',class {callback:ResizeObserverCallback;constructor(callback:ResizeObserverCallback){this.callback=callback;} observe(target:Element){observed.push(target);this.callback([{contentRect:{width:960}}] as ResizeObserverEntry[],this as unknown as ResizeObserver);}disconnect=disconnect;});
   const {host,root}=render(<ScoreChart task={task} iterations={[]} locale="zh" onOpen={noOp}/>);expect(observed).toHaveLength(0);
   act(()=>root.render(<ScoreChart task={task} iterations={[scored]} locale="zh" onOpen={noOp}/>));
   expect(observed).toHaveLength(1);expect(observed[0]).toBe(host.querySelector('.rsi-score-chart'));expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 960 280');
   act(()=>root.render(<ScoreChart task={task} iterations={[]} locale="zh" onOpen={noOp}/>));expect(disconnect).toHaveBeenCalledOnce();
 });
 it.each([1,3,17,103])('draws unique integer score ticks for maximum %s while retaining fractional delta',score=>{
   const {host}=render(<ScoreChart task={{...task,baselineTrainScore:1,delta:.3}} iterations={[{...scored,trainScore:score}]} locale="en" onOpen={noOp}/>);
   const ticks=[...host.querySelectorAll('text[text-anchor=end]')].map(t=>t.textContent!).filter(t=>!t.startsWith('Baseline')).map(Number);
   expect(ticks.length).toBeGreaterThan(1);expect(new Set(ticks).size).toBe(ticks.length);expect(ticks.every(Number.isInteger)).toBe(true);expect(ticks.at(-1)).toBeGreaterThanOrEqual(score+.3);expect(host.querySelector('rect title')!.textContent).toBe('δ 0.3');
 });
 it('displays observed iteration tokens and explains every missing role',()=>{
   vi.useFakeTimers();const {host}=render(<IterationTable items={[scored]} task={task} metrics={{iterations:[metric],cacheHitRate:null,helpReason:null,pendingCommands:0,baselineProgress:null}} locale="en" onOpen={noOp}/>);
   const tokens=host.querySelector<HTMLElement>('td[data-column=tokens] [tabindex]')!;expect(tokens.textContent).toBe('3K ⓘ');act(()=>tokens.focus());act(()=>vi.advanceTimersByTime(300));expect(document.querySelector('[role=tooltip]')!.textContent).toBe('3,000 · Incomplete usage; missing: Review');
 });
 it('hides pagination for a single page, offers next on the first page and first on subsequent pages',()=>{
   const onCursor=vi.fn(),{host,root}=render(<CursorPagination cursor={null} nextCursor={null} locale="zh" onCursor={onCursor}/>);expect(host.querySelector('button')).toBeNull();
   act(()=>root.render(<CursorPagination cursor={null} nextCursor="next" locale="zh" onCursor={onCursor}/>));expect(host.textContent).toBe('下一页');act(()=>host.querySelector('button')!.click());expect(onCursor).toHaveBeenLastCalledWith('next');
   act(()=>root.render(<CursorPagination cursor="next" locale="en" onCursor={onCursor}/>));expect(host.textContent).toBe('First page');act(()=>host.querySelector('button')!.click());expect(onCursor).toHaveBeenLastCalledWith(null);
 });
 it.each(['zh','en'] as const)('uses neutral condition titles and no fabricated comparisons for qualitative verdicts (%s)',locale=>{
   const {host}=render(<Verdicts verdict={verdict} locale={locale}/>),cards=[...host.querySelectorAll('.ui-verdict-card')];
   expect(cards.map(c=>c.querySelector('.ui-muted')!.textContent)).toEqual(locale==='zh'?['防作弊','主指标','封存集','稳定题','Token 增幅']:['Anti-cheating','Primary metric','Sealed set','Stable questions','Token growth']);
   for(const index of [0,3]){expect(cards[index]!.textContent).not.toContain('—');expect(cards[index]!.textContent).not.toContain('→');expect(cards[index]!.textContent).toContain(locale==='zh'?'通过':'Pass');}
 });
 it('shows successful reviews beside the layer title, without empty evidence or a finding row',()=>{
   const {host}=render(<Findings findings={[{id:'f',taskId:'task',iterationId:'iteration',level:'L4',category:'review_clean',source:'monitor',severity:'info',evidence:null,file:null,line:null,at}]} locale="zh" onDiff={noOp}/>);
   expect(host.querySelector('h2')!.textContent).toContain('审查通过');expect(host.querySelector('.rsi-finding,.rsi-evidence')).toBeNull();
 });
 it.each(['clean','suspicious','missing'] as const)('renders parsed process %s evidence as human fields, including old misclassified records',status=>{
   const {host}=render(<Findings findings={[{id:'f',taskId:'task',iterationId:'iteration',level:'L4',category:'suspicious',source:'process_monitor',severity:'info',evidence:JSON.stringify({status,evidence:status==='suspicious'?['exact line']:[],reason:status==='missing'?'session_missing':'ok'}),file:null,line:null,at}]} locale="zh" onDiff={noOp}/>);
   expect(host.textContent).toContain('结论');expect(host.textContent).toContain('原因');expect(host.textContent).not.toContain('"status"');expect(host.textContent).not.toContain('"evidence"');expect(host.textContent).toContain('仅供参考，不影响判定');
   if(status==='clean'){expect(host.querySelector('.rsi-finding')).toBeNull();expect(host.textContent).toContain('未发现可疑行为');}
   if(status==='suspicious')expect(host.textContent).toContain('exact line');
   if(status==='missing')expect(host.textContent).toContain('优化者会话证据缺失');
   expect(host.querySelector('.rsi-evidence')).toBeNull();
 });
 it('retains unparseable process evidence as text',()=>{
   const {host}=render(<Findings findings={[{id:'f',taskId:'task',iterationId:'iteration',level:'L4',category:'suspicious',source:'process_monitor',severity:'info',evidence:'{truncated',file:null,line:null,at}]} locale="en" onDiff={noOp}/>);expect(host.querySelector('pre')!.textContent).toBe('{truncated');
 });
 it('shows that a person approved the token growth instead of a plain pass',()=>{
   const {host}=render(<Verdicts verdict={{...verdict,approvedCategories:['token_growth']}} locale="zh"/>),card=[...host.querySelectorAll('.ui-verdict-card')].find(c=>c.textContent?.includes('Token 增幅'))!;
   expect(card.textContent).toContain('人工确认后通过');
 });
 it('formats peak memory in byte units',()=>{
   const {host}=render(<RunTable rows={[{id:'r',questionId:'q',phase:'train',language:'javascript',outcome:'pass',failureReason:null,tokens:1,durationMs:1,memoryPeakBytes:39800000,sessionTokens:null,tokenDifference:null,at,repetition:0,attempt:0}]} locale="en" onTrace={noOp}/>);expect(host.querySelector('td[data-column=memory]')!.textContent).toBe('39.8 MB');
 });
 it('keeps the question phase in the deep link and resets pagination when it changes',async()=>{
   const fetcher=fixtureReads(),route=parseRsiRoute('#/rsi?task=task&iter=1&tab=runs&phase=sealed'),onRoute=vi.fn();
   await act(async()=>render(<IterationDetail taskId="task" iteration={iteration} metric={metric} locale="en" route={route} onRoute={onRoute} revision={0} parentSeq={null}/>));
   expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/runs?limit=200&phase=sealed'))).toBe(true);
   const train=[...document.querySelectorAll<HTMLButtonElement>('.rsi-toolbar [role=tab]')].find(b=>b.textContent==='Training set')!;expect(train).toBeDefined();act(()=>train.click());expect(onRoute).toHaveBeenCalledWith({phase:'train',cursor:null});
 });
 it('keeps task help on the task page and out of iteration detail',async()=>{
   fixtureReads();window.location.hash='#/rsi?task=task&iter=1';
   const overview:RsiOverview={tasks:[],reviews:[],pendingCount:0};let root:Root,host:HTMLElement;
   await act(async()=>{({root,host}=render(<RsiPage {...props} overview={overview}/>));});expect(host!.textContent).not.toContain('优化者需要帮助');expect(host!.querySelector('.rsi-detail-page')).not.toBeNull();
   await act(async()=>{window.location.hash='#/rsi?task=task';window.dispatchEvent(new HashChangeEvent('hashchange'));});expect(root!).toBeDefined();expect(host!.textContent).toContain('优化者需要帮助');
 });
 it('does not repeat the audit type in its reason column',()=>{
   window.location.hash='#/rsi?view=review';const {host}=render(<RsiPage {...props} overview={{tasks:[],pendingCount:1,reviews:[{id:'audit',taskId:'task',taskName:'Agent · repo',kind:'audit',iteration,reasons:['random_audit'],at}]}}/>);
   expect(host.querySelector('td[data-column=kind]')!.textContent).toBe('随机抽检');expect(host.querySelector('td[data-column=reason]')!.textContent).toBe('—');
 });
 it('does not show first-page controls on a one-page iteration table',()=>{
   const {host}=render(<TaskDetail task={task} iterations={[scored]} metrics={null} locale="en" route={parseRsiRoute('#/rsi?task=task&tab=iterations')} onRoute={noOp} onSuccess={noOp} revision={0} onOpen={noOp}/>);expect(host.textContent).not.toContain('First page');
 });
});
