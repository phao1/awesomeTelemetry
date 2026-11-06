import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, rm, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import type { RsiCommand, RsiConfig, RsiQueueItem } from '../../src/core/rsi-types.js';
import { validateRsiConfig, validateRsiQueueItem, validateRsiTask } from '../../src/core/rsi-validation.js';
import { buildFingerprintDictionary } from '../../src/core/rsi-l1-rules.js';
import { transitionIteration, transitionTask } from '../../src/core/rsi-state-machine.js';
import { selectParent } from '../../src/core/rsi-gate.js';
import type { WorkerSettings } from './worker.js';
import { validateWorkerSettings } from './worker.js';
import { freezeBank, readBank } from './bank.js';
import { freezeAgentProfile, readFrozenAgent } from './agent-profile.js';
import { freezeOptimizerProfile } from './optimizer-profile.js';
import { treeFiles, privateWrite } from './artifacts.js';
import { canonicalJson } from './ledger.js';
import type { RsiStore } from './queue.js';
import { enqueue, now, taskLock } from './queue.js';
import { boundedJson, conflict, RsiError, validId } from './reader.js';

export interface CreateTaskInput {
  requestId: string; repository: string; baselineCommit: string; agentProfile: string;
  optimizerProfile: string; bank: string; subset?: 'small' | 'full'; config: RsiConfig; settings?: Pick<WorkerSettings, 'optimizerSessionTokens' | 'optimizerSessionTimeoutMs' | 'allowUnmeteredOptimizer' | 'concurrency'>;
}
function invalidField(field: string, reason: string): never { throw new RsiError(400, 'RSI_INVALID_REQUEST', {field,reason}); }
export async function createTask(store: RsiStore, input: CreateTaskInput, settings: WorkerSettings): Promise<{ taskId: string; queueId: string; status: 'queued'; agentToken: string | null }> {
  validId(input.requestId);
  for (const key of ['repository','agentProfile','optimizerProfile','bank'] as const) if (typeof input[key] !== 'string' || !isAbsolute(input[key]) || input[key].includes('\0')) invalidField(key,'absolute_path_required');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.baselineCommit)) invalidField('baselineCommit','full_commit_required');
  if (!['small','full'].includes(input.subset ?? 'full')) invalidField('subset','invalid_value');
  if(input.settings!==undefined&&(input.settings===null||typeof input.settings!=='object'||Array.isArray(input.settings)))invalidField('settings','invalid_value');
  if(input.settings) {
    for(const key of Object.keys(input.settings)) if(!['optimizerSessionTokens','optimizerSessionTimeoutMs','allowUnmeteredOptimizer','concurrency'].includes(key)) invalidField('settings','invalid_value');
    for(const [key,value] of Object.entries(input.settings)) if(key==='allowUnmeteredOptimizer'?typeof value!=='boolean':!Number.isSafeInteger(value)||Number(value)<1||(key==='concurrency'&&Number(value)>32)) invalidField('settings.'+key,'invalid_value');
    settings={...settings,...input.settings};
  }
  validateRsiConfig(input.config); validateWorkerSettings(settings);
  return taskLock(store.root, 'ingress', async () => {
    await store.refresh();
    if (store.list('task_put').length) {
      const previous = await boundedJson(store.root, 'private/create.json');
      if (canonicalJson(previous) !== canonicalJson(input)) return conflict();
      await enqueue(store, { action: 'start' }, 'human', input.requestId);
      return { taskId: store.taskId, queueId: input.requestId, status: 'queued', agentToken: null };
    }
  for (const field of ['repository','agentProfile','optimizerProfile','bank'] as const) {
    let resolved: string;
    try { resolved = await realpath(input[field]); } catch(error) { if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??'')) return invalidField(field,'path_not_found');if((error as NodeJS.ErrnoException).code==='EACCES')return invalidField(field,'path_unreadable'); throw error; }
    const inputStat=await lstat(resolved);if((field==='repository'||field==='bank')?!inputStat.isDirectory():!inputStat.isFile())invalidField(field,field==='repository'||field==='bank'?'directory_required':'profile_file_required');
    for (const name of ['.codex','.claude','.ssh']) { const forbidden=join(homedir(),name); if(resolved===forbidden||resolved.startsWith(forbidden+sep)||forbidden.startsWith(resolved+sep)) invalidField(field,'forbidden_path'); }
  }
    // Trusted local files still have aggregate/per-file bounds before bank reads.
    try {
      let size = 0;
      for (const file of await treeFiles(input.bank)) {
        const stat = await lstat(join(input.bank, file)); size += stat.size;
        if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || size > 64 * 1024 * 1024) throw new RsiError(413, 'RSI_LIMIT', {field:'bank',reason:'bank_too_large'});
      }
    } catch(error) {if(error instanceof RsiError)throw error;return invalidField('bank','invalid_bank');}
    await rm(join(store.root, 'private'), { force: true, recursive: true });
    await mkdir(join(store.root, 'private'), { recursive: true, mode: 0o700 });
    for (const file of [input.agentProfile,input.optimizerProfile]) if ((await lstat(file)).size > 1024*1024) throw new RsiError(413,'RSI_LIMIT');
    const runtime = structuredClone(settings);
    if(runtime.reviews) { const {optimizerFamily:_ignored,...reviews}=runtime.reviews;runtime.reviews=reviews; }
    try { runtime.agent = await freezeAgentProfile(input.agentProfile, join(store.root, 'private/agent')); } catch(error) { const field=error instanceof Error ? /^Invalid agent profile: ([A-Za-z0-9_.[\]]+)/.exec(error.message)?.[1] : null; return invalidField('agentProfile'+(field?'.'+field:''),'invalid_profile'); }
    try { runtime.optimizer = await freezeOptimizerProfile(input.optimizerProfile, join(store.root, 'private/optimizer')); } catch(error) {const field=error instanceof Error?/^Invalid (?:agent|optimizer) profile: ([A-Za-z0-9_.[\]]+)/.exec(error.message)?.[1]:null;return invalidField('optimizerProfile'+(field?'.'+field:''),'invalid_profile');}
    const bank = await (async()=>{try {return await freezeBank(await readBank(input.bank), join(store.root, 'private/bank'), input.subset ?? 'full');} catch {return invalidField('bank','invalid_bank');}})();
    await privateWrite(join(store.root, 'private/fingerprints.json'), JSON.stringify(buildFingerprintDictionary([...bank.questions.values()], input.config.l1)));
    await privateWrite(join(store.root, 'private/runtime.json'), JSON.stringify(runtime));
    await privateWrite(join(store.root, 'private/create.json'), canonicalJson(input));
    const token = randomBytes(32).toString('hex'), at = now();
    const task = validateRsiTask({ id: store.taskId, repository: input.repository, baselineCommit: input.baselineCommit,
      datasetHash: bank.datasetHash, mainMetric: 'passed_count', config: input.config, state: 'created', pauseReason: null,
      delta: null, baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0, tokenUsage: 0, iterationCount: 0, monitorCalibration: null,
      currentParentId: null, taskTokenHash: createHash('sha256').update(token).digest('hex'), createdAt: at, updatedAt: at });
    await store.put({ event: 'task_put', payload: task }, 'human');
    const q = await enqueue(store, { action: 'start' }, 'human', input.requestId);
    return { taskId: store.taskId, queueId: q.id, status: 'queued', agentToken: token };
  });
}
export function selectedParent(store: RsiStore): string | null {
  const task = store.task();
  if (task.baselineTrainScore === null || task.delta === null) return null;
  const versions = [{ iterationId: null, seq: 0, state: 'baseline' as const, trainScore: task.baselineTrainScore! },
    ...store.list('iteration_put').filter(i => i.state === 'promoted').map(i => ({ iterationId: i.id, seq: i.seq, state: i.state, trainScore: i.trainScore! }))];
  const lastSession = store.list('session_put').sort((a,b) => b.seq-a.seq)[0];
  const lastIteration = store.list('iteration_put').sort((a,b) => b.seq-a.seq)[0];
  const lastRound = [lastSession?.startedAt, lastIteration?.createdAt].filter((v): v is string => v !== undefined).sort().at(-1);
  const rollback = store.list('queue_put').filter(q => q.command.action === 'rollback' && q.state === 'completed' && (!lastRound || q.updatedAt >= lastRound)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0];
  return selectParent(versions, task.delta ?? 0, rollback?.command.action === 'rollback' ? rollback.command.parentId : undefined).iterationId;
}
export async function humanCommand(store: RsiStore, command: RsiCommand, requestId: string, iterationId: string | null): Promise<RsiQueueItem> {
  return taskLock(store.root,'ingress',async()=>{await store.refresh();return enqueueHumanCommand(store,command,requestId,iterationId);});
}
async function enqueueHumanCommand(store: RsiStore, command: RsiCommand, requestId: string, iterationId: string | null): Promise<RsiQueueItem> {
  if (!command || typeof command !== 'object' || typeof command.action !== 'string') throw new RsiError(400,'RSI_INVALID_REQUEST');
  if (!['approve','reject','retry_review','retry_evaluation','pause','resume','stop','rollback','instruction','set_budget','set_target','final','adopt'].includes(command.action)) throw new RsiError(403, 'RSI_FORBIDDEN');
  validId(requestId); if (iterationId !== null) validId(iterationId);
  const iterationAction = ['approve','reject','retry_review','retry_evaluation','final','adopt'].includes(command.action);
  if (iterationAction !== (iterationId !== null)) throw new RsiError(400, 'RSI_INVALID_REQUEST');
  if (store.list('queue_put').some(q => q.id === requestId)) return enqueue(store, command, 'human', requestId, iterationId);
  const t=store.task(), at=now();
  validateRsiQueueItem({id:requestId,taskId:t.id,kind:command.action==='final'||command.action==='adopt'?command.action:'intervene',iterationId,evaluationId:null,state:'queued',requestedBy:'human',reason:'reason' in command?command.reason:null,command,createdAt:at,updatedAt:at});
  const i=iterationId===null?null:store.list('iteration_put').find(i=>i.id===iterationId);
  if(iterationAction&&!i)throw new RsiError(404,'RSI_NOT_FOUND');
  if(['approve','reject','retry_review','retry_evaluation'].includes(command.action)){
    try{transitionIteration(i!.state,command.action as 'approve'|'reject'|'retry_review'|'retry_evaluation',{actor:'human',reason:'reason' in command?command.reason:'',holdReasons:i!.holdReasons,...(i!.resumeState?{resumeState:i!.resumeState}:{}),...(command.action==='approve'?{approvedCategories:command.categories}:{}),sealedBudgetRemaining:t.config.sealedQueryBudget-t.sealedQueriesUsed+(store.list('evaluation_put').some(e=>e.iterationId===i!.id&&e.phase==='sealed')?1:0),hasSealedResult:store.list('evaluation_put').some(e=>e.iterationId===i!.id&&e.phase==='sealed'&&e.state==='completed'&&e.score!==null)});}catch{return conflict();}
  }
  if(command.action==='pause'||command.action==='resume'||command.action==='stop'){
    try{transitionTask(t.state,command.action,{actor:'human',reason:command.reason,budgetAvailable:t.tokenUsage<t.config.maxTaskTokens&&t.iterationCount<t.config.maxIterations,calibrationComplete:t.delta!==null&&t.baselineSealedScore!==null,targetReached:store.list('iteration_put').some(i=>i.state==='promoted'&&i.trainScore!>=t.config.targetPassedCount)});}catch{return conflict();}
  }
  if(command.action==='set_budget'&&command.sealedQueryBudget<t.sealedQueriesUsed)return conflict();
  if(command.action==='final'){
    if(i!.state!=='promoted'||!['running','completed'].includes(t.state))return conflict();
    if(t.tokenUsage>=t.config.maxTaskTokens||t.iterationCount>=t.config.maxIterations)throw new RsiError(409,'RSI_BUDGET_EXHAUSTED');
    if(store.list('evaluation_put').some(e=>e.phase==='final'&&e.commit===i!.commit)||store.list('queue_put').some(q=>q.kind==='final'&&store.list('iteration_put').find(i=>i.id===q.iterationId)?.commit===i!.commit))throw new RsiError(409,'RSI_FINAL_LOCKED');
  }
  if (command.action === 'adopt') {
    const i = store.list('iteration_put').find(i => i.id === iterationId);
    if (!i || i.state !== 'promoted' || !store.list('evaluation_put').some(e => e.commit === i.commit && e.phase === 'final' && e.locked && e.state === 'completed' && e.score !== null && e.infraErrorRatio === 0)) return conflict();
  }
  if (command.action === 'rollback' && command.parentId !== null && !store.list('iteration_put').some(i => i.id === command.parentId && i.state === 'promoted')) conflict();
  if (command.action === 'instruction' && command.effectiveFromSeq <= Math.max(0, ...store.list('iteration_put').map(i => i.seq))) conflict();
  return enqueue(store, command, 'human', requestId, iterationId);
}
export async function agentCommand(store: RsiStore, requestId: string, command: RsiCommand): Promise<RsiQueueItem> {
  validId(requestId);
  return taskLock(store.root, 'ingress', async () => {
    await store.refresh();
    const hashes=[store.task().taskTokenHash];
    try { const session=await boundedJson(store.root,'private/agent-session.json',4096) as {tokenHash:string};hashes.push(session.tokenHash); } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; }
    for(const token of canonicalJson([requestId,command]).match(/[a-f0-9]{64}/g)??[]) if(hashes.includes(createHash('sha256').update(token).digest('hex')))throw new RsiError(400,'RSI_INVALID_REQUEST');
    const old = store.list('queue_put').find(q => q.id === requestId);
    if (old) {
      if (old.command.action !== command.action) return conflict();
      const retry = command.action === 'submit' && old.command.action === 'submit' ? { ...command, parentId: old.command.parentId } : command;
      return enqueue(store, retry, 'optimizer', requestId);
    }
    if (store.task().state !== 'running') return conflict();
    const t=store.task();if(t.tokenUsage>=t.config.maxTaskTokens||t.iterationCount>=t.config.maxIterations)throw new RsiError(409,'RSI_BUDGET_EXHAUSTED');
    const session = store.list('session_put').find(s => s.state === 'running');
    const pending = store.list('queue_put').some(q => q.requestedBy === 'optimizer' && (session ? q.createdAt >= session.startedAt : ['queued','running'].includes(q.state)));
    if (pending || store.list('iteration_put').some(i => !['promoted','rejected'].includes(i.state))) return conflict();
    const cmd = command.action === 'submit' ? { ...command, parentId: session ? session.parentId : selectedParent(store) } : command;
    const at = now(); validateRsiQueueItem({ id: requestId, taskId: store.taskId, kind: cmd.action === 'submit' ? 'submit' : 'intervene', iterationId: null, evaluationId: null, state: 'queued', requestedBy: 'optimizer', reason: 'reason' in cmd ? cmd.reason : null, command: cmd, createdAt: at, updatedAt: at });
    return enqueue(store, cmd, 'optimizer', requestId);
  });
}
export async function targetAllowPaths(store: RsiStore): Promise<string[]> {
  const settings = await boundedJson(store.root, 'private/runtime.json') as WorkerSettings;
  const p = await readFrozenAgent(join(store.root, 'private/agent'), settings.agent);
  return p.l1?.allowPaths ?? [];
}
