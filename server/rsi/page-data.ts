import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, realpath, lstat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import type { RsiIteration, RsiOutcome } from '../../src/core/rsi-types.js';
import { rsiCliInfo, rsiPackageRoot } from './paths.js';
import type { RsiBankDistribution, RsiOverview, RsiOptions, RsiWorkerStatus, RsiMetrics, RsiPageRun, RsiReviewEvidence, RsiVerdict, RsiLedgerReport, RsiDefenseState, RsiProfileOption, RsiTraceUsage } from '../../src/core/rsi-api-client.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import { decidePromotion } from '../../src/core/rsi-gate.js';
import type { RsiStore } from './queue.js';
import { boundedJson, boundedText, safeArtifact, RsiError } from './reader.js';
import { getRsiLedgerHead } from '../storage/rsi.js';
import { verifyLedger } from './ledger.js';
import { finalRuns, promotionInput } from './verdict.js';
import { selectBankSubset } from './bank.js';
import type { RsiBankManifest } from './bank.js';
import { selectAblationPatch } from './ablation.js';

const cache = new Map<string, { at: number; value: unknown }>();
export async function cachedPage<T>(key: string, read: () => Promise<T>): Promise<T> {
  const prior = cache.get(key);
  if (prior && Date.now() - prior.at < 2000) return structuredClone(prior.value) as T;
  const value = await read();
  if (Buffer.byteLength(JSON.stringify(value)) > 1048576) throw new RsiError(413, 'RSI_LIMIT');
  cache.delete(key); cache.set(key, { at: Date.now(), value });
  while (cache.size > 24) cache.delete(cache.keys().next().value!);
  return structuredClone(value);
}
const key = (store: RsiStore, kind: string) => `${store.root}:${getRsiLedgerHead(store.db, store.taskId)?.hash}:${kind}`;
export async function optionalArtifact<T>(root: string, path: string, limit?: number): Promise<T | null> {
  try { return await boundedJson(root, path, limit) as T; }
  catch (error) { if (['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null; throw error; }
}
async function names(root: string, path: string): Promise<string[]> {
  try { return (await readdir(path === '.' ? await realpath(root) : await safeArtifact(root, path))).filter(v => /^[A-Za-z0-9_.-]+$/.test(v) && v !== '.' && v !== '..').sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export async function workerStatus(store: RsiStore): Promise<RsiWorkerStatus> {
  const v = await optionalArtifact<{ pid: number; at: string; phase: string; upstreamConfigured?: boolean; lastError?: string | null }>(store.root, 'private/worker.json', 4096);
  if (!v) return { pid: null, at: null, phase: null, running: false, upstreamConfigured: null, lastError: null };
  let live = false;
  if (Number.isSafeInteger(v.pid) && v.pid > 0) try { process.kill(v.pid, 0); live = true; } catch { live = false; }
  const running = live && v.phase !== 'stopped' && Date.now() - Date.parse(v.at) >= 0 && Date.now() - Date.parse(v.at) < 15000;
  return { pid: v.pid, at: v.at, phase: v.phase, running, upstreamConfigured: running && typeof v.upstreamConfigured === 'boolean' ? v.upstreamConfigured : null, lastError: typeof v.lastError === 'string' ? v.lastError : null };
}
async function manifest(store: RsiStore): Promise<RsiBankManifest | null> {
  return cachedPage(key(store,'bank-metadata'),()=>optionalArtifact<RsiBankManifest>(store.root,'private/bank/manifest.json'));
}
export async function overview(stores: RsiStore[]): Promise<RsiOverview> {
  if (stores.length > 200) throw new RsiError(413, 'RSI_LIMIT');
  const result: RsiOverview = { tasks: [], reviews: [], pendingCount: 0 };
  for (const store of stores) {
    const { taskTokenHash: _secret, ...task } = store.task();
    const agent = await optionalArtifact<{ name: string }>(store.root, 'private/agent/profile.json');
    const optimizer = await optionalArtifact<{ name: string }>(store.root, 'private/optimizer/profile.json');
    const repositoryName = basename(task.repository), taskName = `${agent?.name ?? '—'} · ${repositoryName}`;
    const iterations = store.list('iteration_put');
    const own: RsiOverview['reviews'] = iterations.filter(i => i.state === 'held').map(i => ({ id: i.id, taskId: task.id, taskName, iteration: i, kind: 'held', reasons: [...i.holdReasons], at: i.updatedAt }));
    for (const q of store.list('queue_put').filter(q => q.command.action === 'review' && q.command.audit && q.state === 'queued')) {
      const i = iterations.find(i => i.id === q.iterationId);
      if (i) own.push({ id: q.id, taskId: task.id, taskName, iteration: i, kind: 'audit', reasons: ['random_audit'], at: q.createdAt });
    }
    const scores = [task.baselineTrainScore, ...iterations.filter(i => i.state === 'promoted').map(i => i.trainScore)].filter((v): v is number => v !== null);
    result.tasks.push({ task, agentName: agent?.name ?? null, optimizerName: optimizer?.name ?? null, repositoryName, pendingCount: own.length,
      bestTrainScore: scores.length ? Math.max(...scores) : null, trainScores: iterations.map(i => ({ seq: i.seq, score: i.trainScore })),
      sealedRemaining: Math.max(0, task.config.sealedQueryBudget - task.sealedQueriesUsed), tokenUsage: task.tokenUsage, tokenBudget: task.config.maxTaskTokens,
      lastActivity: [task.updatedAt,...iterations.map(i=>i.updatedAt),...store.list('queue_put').map(q=>q.updatedAt),...store.list('session_put').map(s=>s.endedAt??s.startedAt)].sort().at(-1)!, trainCount: (await manifest(store))?.sets.train.length ?? null, worker: await workerStatus(store) });
    result.reviews.push(...own);
  }
  if (result.reviews.length > 2000) throw new RsiError(413, 'RSI_LIMIT');
  result.pendingCount = result.reviews.length; result.reviews.sort((a,b) => a.at.localeCompare(b.at));
  return result;
}
function distribution(m: RsiBankManifest): RsiBankDistribution[] {
  return (['smoke','train','sealed','final'] as const).map(phase => {
    const languages: Record<string, number> = {};
    for (const q of m.questions) if (m.sets[phase].includes(q.id)) languages[q.language] = (languages[q.language] ?? 0) + 1;
    return { phase, count: m.sets[phase].length, languages };
  });
}
export async function pageOptions(dataRoot: string): Promise<RsiOptions> {
  const packageRoot = rsiPackageRoot();
  return cachedPage('options:' + packageRoot + ':' + dataRoot, async () => {
    const root = join(packageRoot, 'rsi-agents'), agents: RsiProfileOption[] = [], optimizers: RsiProfileOption[] = [];
    async function profiles(parent: string, output: RsiProfileOption[], optimizer: boolean): Promise<void> {
      for (const id of await names(root, parent)) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) continue;
        const directory=join(parent,id);if(!(await stat(await safeArtifact(root,directory))).isDirectory())continue;
        for(const filename of (await names(root,directory)).filter(file=>/^profile(?:[A-Za-z0-9_.-]*)\.json$/.test(file))){
          const relative=join(directory,filename),p=await optionalArtifact<Record<string, unknown>>(root,relative);
          if (!p || typeof p.name !== 'string' || p.name.length>512 || typeof p.id !== 'string'||!/^[A-Za-z0-9_-]{1,128}$/.test(p.id)) continue;
          const egress = p.egress as { kind?: 'model-proxy' | 'vendor-allowlist' } | undefined, login = p.login as { kind?: string } | undefined;
          output.push({ id: p.id, path: join(root,relative), name: p.name, description: typeof p.description === 'string'&&p.description.length<=1024 ? p.description : null,
            family: typeof p.family === 'string' ? p.family : null, egress: egress?.kind ?? null, loginRequired: optimizer && login?.kind === 'volume', verified: ['opencode-deepseek','mini-agent','scripted'].includes(p.id) && p.verified !== false });
        }
      }
    }
    await profiles('.', agents, false); await profiles('optimizers', optimizers, true);
    let bank: RsiOptions['bank'] = null;
    try { const m=await boundedJson(packageRoot,'rsi-bank/manifest.json') as RsiBankManifest; bank={path:join(packageRoot,'rsi-bank'),full:distribution(m),small:distribution(selectBankSubset(m,'small'))}; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { cli: rsiCliInfo(dataRoot), agents, optimizers, bank, defaults: defaultRsiConfig(), settings: { optimizerSessionTokens: 2000000, optimizerSessionTimeoutMs: 1800000, allowUnmeteredOptimizer: false, concurrency: 2 } };
  });
}
interface Telemetry { memoryPeakBytes: number | null; sessionTokens: number | null; input: number | null; cached: number | null; requests:RsiTraceUsage[]|null }
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
/** Reads only observed, settled usage. Bound both bytes and lines, stream JSONL. */
export async function runTelemetry(root: string, artifact: string | null, details=false): Promise<Telemetry> {
  const absent: Telemetry = { memoryPeakBytes: null, sessionTokens: null, input: null, cached: null, requests:null };
  if (!artifact) return absent;
  if(!details){const saved=await optionalArtifact<Telemetry>(root,join(artifact,'page-metrics.json'));if(saved)return {memoryPeakBytes:number(saved.memoryPeakBytes),sessionTokens:number(saved.sessionTokens),input:number(saved.input),cached:number(saved.cached),requests:null};}
  const target = await optionalArtifact<Record<string, unknown>>(root, join(artifact, 'target.json'));
  absent.memoryPeakBytes = number(target?.memoryPeakBytes); absent.sessionTokens = number(target?.sessionTokens);
  let file: string;
  try { file = await safeArtifact(root, join(artifact, 'proxy/usage.jsonl')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return absent; throw error; }
  if ((await stat(file)).size > 8 * 1024 * 1024) return absent;
  const entries = new Map<string, { stage?: string; complete?: boolean; error?: unknown; usage?: { input?: number; cached?: number;total?:number } }>();
  let bytes = 0;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    bytes += Buffer.byteLength(line) + 1; if (bytes > 8 * 1024 * 1024 || Buffer.byteLength(line) > 1048576) return absent;
    let v: Record<string, unknown>;
    try { v = JSON.parse(line) as Record<string, unknown>; } catch { return absent; }
    if (typeof v.requestId !== 'string') return absent;
    entries.set(v.requestId, v);
  }
  if (!entries.size || [...entries.values()].some(e => e.stage !== 'settled' || !e.complete || e.error || number(e.usage?.input) === null || number(e.usage?.cached) === null || e.usage!.cached! > e.usage!.input!)) return absent;
  return { ...absent, requests:[...entries.entries()].map(([requestId,e])=>({requestId,tokens:number(e.usage?.total),cacheHitRate:e.usage!.input!>0?e.usage!.cached!/e.usage!.input!:null})), input: [...entries.values()].reduce((n,e) => n + e.usage!.input!, 0), cached: [...entries.values()].reduce((n,e) => n + e.usage!.cached!, 0) };
}
export async function iterationRuns(store: RsiStore, i: RsiIteration): Promise<RsiPageRun[]> {
  return cachedPage(key(store, `runs:${i.id}`), async () => {
    const evaluations = store.list('evaluation_put').filter(e => e.iterationId === i.id), bank = await manifest(store), rows: RsiPageRun[] = [];
    for (const r of store.list('run_put')) {
      const e = evaluations.find(e => e.id === r.evaluationId); if (!e) continue;
      const t = await cachedPage(key(store, `telemetry:${r.id}`), () => runTelemetry(store.root, r.artifactPath));
      rows.push({ id: r.id, questionId: r.questionId, phase: e.phase, language: bank?.questions.find(q=>q.id===r.questionId)?.language ?? null, outcome: r.outcome, failureReason: r.failureReason,
        tokens: r.proxyTokens, durationMs: r.durationMs, memoryPeakBytes: t.memoryPeakBytes, sessionTokens: t.sessionTokens,
        tokenDifference: r.proxyTokens !== null && t.sessionTokens !== null ? r.proxyTokens - t.sessionTokens : null, at: r.at, repetition: r.repetition, attempt: r.attempt });
    }
    return rows;
  });
}
export async function metrics(store: RsiStore): Promise<RsiMetrics> {
  return cachedPage(key(store, 'metrics'), async () => {
    const iterations: RsiMetrics['iterations'] = [], all = store.list('run_put'), evaluations = store.list('evaluation_put'); let input = 0, cached = 0, cacheComplete = true;
    for (const i of store.list('iteration_put')) {
      const eids = new Set(evaluations.filter(e => e.iterationId === i.id).map(e => e.id)), runs = all.filter(r => eids.has(r.evaluationId));
      const session = store.list('session_put').find(s => {
        const q = store.list('queue_put').find(q => q.id === s.submissionId);
        return q?.command.action === 'submit' && q.command.commit === i.commit && q.command.parentId === i.parentId && (q.iterationId === i.id || createHash('sha256').update(`iteration:${q.id}`).digest('hex') === i.id);
      }) ?? null;
      let ownInput = 0, ownCached = 0, complete = !!runs.length;
      for (const r of runs) { const t = await cachedPage(key(store, `telemetry:${r.id}`), () => runTelemetry(store.root, r.artifactPath)); if (t.input === null || t.cached === null) complete = false; else { ownInput += t.input; ownCached += t.cached; } }
      cacheComplete &&= complete; input += ownInput; cached += ownCached;
      const usage=await optionalArtifact<{receipts:Record<string,number|null>}>(store.root,`artifacts/${i.id}/review-usage.json`);
      const reviewTokens=usage&&Object.keys(usage.receipts).length&&Object.values(usage.receipts).every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)?Object.values(usage.receipts).reduce<number>((n,v)=>n+v!,0):null;
      iterations.push({ iteration: i, iterationId: i.id, seq: i.seq, targetTokens: runs.length && runs.every(r => r.proxyTokens !== null) ? runs.reduce((n,r) => n + r.proxyTokens!, 0) : null,
        optimizerTokens: session?.tokens ?? null, reviewTokens, durationMs: runs.length ? runs.reduce((n,r) => n + r.durationMs, 0) : null,
        cacheHitRate: complete && ownInput > 0 ? ownCached / ownInput : null, defenses: (await verdict(store,i)).defenses, finalState: evaluations.some(e=>e.commit===i.commit&&e.phase==='final'&&e.locked&&e.state==='completed'&&e.score!==null&&e.infraErrorRatio===0)?'completed':evaluations.some(e=>e.commit===i.commit&&e.phase==='final')||store.list('queue_put').some(q=>q.command.action==='final'&&q.iterationId===i.id)?'reserved':'not_requested', reason: complete ? 'review_usage_unavailable' : 'usage_unavailable', session });
    }
    const baseline = evaluations.filter(e => e.iterationId === null && ['train','sealed'].includes(e.phase)), bank = await manifest(store);
    return { iterations, cacheHitRate: iterations.length && cacheComplete && input > 0 ? cached / input : null,
      helpReason: store.list('queue_put').filter(q=>q.command.action==='declare_stuck').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.reason ?? null,
      pendingCommands: store.list('queue_put').filter(q=>q.state==='queued'&&!(q.command.action==='review'&&q.command.audit)).length,
      baselineProgress: bank ? { completed: baseline.reduce((n,e) => n + finalRuns(e,all).length,0), planned: bank.sets.train.length * store.task().config.noiseRepeats + bank.sets.sealed.length * 3 } : null };
  });
}
export async function reviewEvidence(store: RsiStore, i: RsiIteration): Promise<RsiReviewEvidence> {
  return cachedPage(key(store, `review:${i.id}`), async () => {
    const directory = `private/reviews/${i.id}`, scopes: { id: string; mtime: number }[] = [];
    for (const scope of await names(store.root, directory)) if (/^[a-f0-9]{64}$/.test(scope)) scopes.push({ id: scope, mtime: (await stat(await safeArtifact(store.root, `${directory}/${scope}`))).mtimeMs });
    const scope = scopes.sort((a,b) => b.mtime - a.mtime || b.id.localeCompare(a.id))[0]?.id ?? null;
    const result: RsiReviewEvidence = { scope, monitor: null, process: null, variants: [], discarded: [], ablation: null }; if (!scope) return result;
    const root = `${directory}/${scope}`;
    const monitor = await optionalArtifact<{ status: 'clean' | 'suspicious' | 'missing'; reason: string; model: string; promptVersion: string; conclusions: { category:string; evidence:string; confidence:number; file: string; line: number }[] }>(store.root, `${root}/monitor.json`);
    const process = await optionalArtifact<{ status: 'clean' | 'suspicious' | 'missing'; reason: string; evidence: string[] }>(store.root, `${root}/process.json`);
    if (monitor) result.monitor = { status: monitor.status, reason: monitor.reason, model: monitor.model??null, promptVersion: monitor.promptVersion??null,conclusions:(monitor.conclusions??[]).slice(0,100).map(c=>({category:c.category,evidence:c.evidence,confidence:c.confidence,file:c.file,line:c.line})) };
    if (process) result.process = { status: process.status, reason: process.reason, evidence: process.evidence.slice(0,100).map(v=>v.slice(0,4096)) };
    const qualified: { source: string; id: string; hash: string }[] = [], discarded: RsiReviewEvidence['discarded'] = [];
    for (const file of await names(store.root, `${root}/variants`)) if (/^[A-Za-z0-9_-]+\.json$/.test(file)) {
      const v = await optionalArtifact<{ questionId: string; reason: string | null; reference: RsiOutcome[]; original: RsiOutcome[]; hash: string; variant: { question: { questionId: string } } | null }>(store.root, `${root}/variants/${file}`, 8*1024*1024);
      if (!v) continue;
      if (v.reason || !v.variant || v.reference.at(-1) !== 'pass' || v.original.at(-1) !== 'fail') discarded.push({ questionId: v.questionId, reason: v.reason ?? (v.reference.at(-1) !== 'pass' ? 'reference_not_passed' : 'original_not_failed') });
      else qualified.push({ source: v.questionId, id: v.variant.question.questionId, hash: v.hash });
    }
    result.discarded = discarded;
    // Reproduce the existing frozen manifest identity to select this scope's exact evaluations.
    const rank=(id:string)=>createHash('sha256').update(JSON.stringify([i.id,id])).digest('hex');
    const ids=[...qualified.map(v=>v.source),...discarded.map(v=>v.questionId)].sort((a,b)=>rank(a).localeCompare(rank(b))||a.localeCompare(b));
    qualified.sort((a,b)=>ids.indexOf(a.source)-ids.indexOf(b.source));discarded.sort((a,b)=>ids.indexOf(a.questionId)-ids.indexOf(b.questionId));
    const manifestHash=createHash('sha256').update(JSON.stringify([ids,qualified.map(v=>[v.id,v.hash]),discarded])).digest('hex');
    const evaluations = store.list('evaluation_put'), all = store.list('run_put');
    for (const v of qualified) {
      const outcome=(side:'parent'|'candidate'):RsiOutcome|null=>{
        const prefix=createHash('sha256').update(`${scope}-${manifestHash}-${side}`).digest('hex').slice(0,40);
        const e=evaluations.find(e=>e.id.startsWith(prefix+'-')&&e.phase==='adversarial'&&e.iterationId===(side==='parent'?i.parentId:i.id)&&e.state==='completed'&&e.score!==null);
        return e?finalRuns(e,all).find(r=>r.questionId===v.id)?.outcome??null:null;
      };
      const p=outcome('parent'),c=outcome('candidate');result.variants.push({questionId:v.id,sourceQuestionId:v.source,parentOutcome:p,candidateOutcome:c,regression:p===null||c===null||p==='infra_error'||c==='infra_error'?null:p==='pass'&&c==='fail'});
    }
    const ablation = await optionalArtifact<{ status: string; reason: string; score: number | null; scoreDrop: number | null }>(store.root, `${root}/ablation.json`);
    if (ablation) {
      let hunks: { file: string; line: number; count: number }[] = [];
      let diff: string | null = null;
      try {diff=await boundedText(store.root,`artifacts/${i.id}/diff.patch`);} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if (diff) hunks = selectAblationPatch(diff, [...store.list('finding_put').filter(f=>f.iterationId===i.id&&f.level==='L1'&&f.source!=='patch_scan'),...(monitor?.conclusions??[]).map(c=>({...c,level:'L4' as const,source:'monitor' as const}))]).hunks;
      result.ablation = { status: ablation.status, reason: ablation.reason, score: ablation.score, scoreDrop: ablation.scoreDrop, hunks };
    }
    return result;
  });
}
export async function verdict(store: RsiStore, i: RsiIteration): Promise<RsiVerdict> {
  const bank = await manifest(store), evidence = await reviewEvidence(store,i);
  const current=evidence.scope?await optionalArtifact<{monitor:{status:'clean'|'suspicious'|'missing'};adversarial:{status:'clean'|'suspicious'|'missing'}}>(store.root,`private/reviews/${i.id}/${evidence.scope}/result.json`):null;
  const input=promotionInput(store,bank?.sets.train??[],i,evidence.scope?current??{monitor:{status:'missing'},adversarial:{status:'missing'}}:undefined),result=decidePromotion(input);
  const task = store.task(), findings = input.findings, evaluations = store.list('evaluation_put');
  const diff = await optionalArtifact(store.root, `artifacts/${i.id}/quality.json`);
  const defenses: RsiVerdict['defenses'] = [];
  for (const level of ['L0','L1','L2','L3','L4','L5'] as const) {
    let state: RsiDefenseState = 'missing', reason = 'evidence_missing';
    const own = findings.filter(f=>f.level===level);
    if (level === 'L0' || level === 'L1') {
      if (own.some(f=>level==='L0'||!['dependency_change','file_mode_change'].includes(f.category))) { state='reject'; reason=level==='L0'?'l0_reject':'l1_reject'; }
      else if (own.length && result.conditions[0]!.reasons.includes('dependency_change')) { state='hold'; reason='dependency_change'; }
      else if (diff && !['draft','submitted','precheck'].includes(i.state)) { state='pass'; reason='precheck_complete'; }
      else if (!['rejected','held'].includes(i.state)) { state='not_reached'; reason='not_reached'; }
    } else if (level === 'L2') {
      const ownSealed=evaluations.filter(e=>e.iterationId===i.id&&e.phase==='sealed'),e=ownSealed.find(e=>e.state==='completed'&&e.score!==null)??ownSealed.at(-1);
      if (!e) { state='not_reached'; reason='not_reached'; }
      else if(e.sealedVerdict) { state=e.sealedVerdict==='accept'?'pass':'reject'; reason=e.sealedVerdict==='accept'?'sealed_accepted':'sealed_regression'; }
    } else if (level === 'L3' || level === 'L4') {
      const review = level==='L3'?input.adversarial:input.monitor;
      if(review?.status==='clean') { state='pass';reason='review_clean'; }
      else if(review?.status==='suspicious') { state='hold';reason=level==='L3'?'l3_suspicious':'l4_suspicious'; }
      else reason=level==='L3'?'missing_adversarial':'missing_monitor';
    } else {
      const c=task.monitorCalibration;
      if(c&&evidence.monitor&&(c.model!==evidence.monitor.model||c.promptVersion!==evidence.monitor.promptVersion)){reason='calibration_stale';}
      else if(c && c.status!=='insufficient' && c.categories.every(m=>m.valid>=Math.max(30,c.minimumSamples))) { state=c.status==='passed'?'pass':'hold';reason=c.status==='passed'?'calibration_passed':'alerts_only'; }
      else reason=c?'insufficient':'uncalibrated';
    }
    defenses.push({level,state,reason});
  }
  const mean=(side:'parentMeanTokens'|'candidateMeanTokens')=>input.tokenPairs.length&&input.tokenPairs.every(p=>p[side]!==null)?input.tokenPairs.reduce((n,p)=>n+p[side]!,0)/input.tokenPairs.length:null;
  return { result, defenses, parentTrainScore:input.parentTrainScore,candidateTrainScore:input.candidateTrainScore,parentSealedScore:input.parentSealedScore,candidateSealedScore:input.candidateSealedScore,delta:task.delta,parentTokens:mean('parentMeanTokens'),candidateTokens:mean('candidateMeanTokens') };
}
export async function ledgerReport(store:RsiStore):Promise<RsiLedgerReport> {
  const head=getRsiLedgerHead(store.db,store.taskId);let version='missing';
  try {const file=await lstat(store.ledgerPath);version=`${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return cachedPage(key(store,`verify:${version}`),async()=>{
    const v=await verifyLedger(store.ledgerPath,{taskId:store.taskId,...(head?{expectedHead:head}:{})});
    return {valid:v.valid,entryCount:v.entryCount,head:v.head,issues:v.issues.map(i=>({code:i.code,line:i.line})),anchored:v.anchored};
  });
}
