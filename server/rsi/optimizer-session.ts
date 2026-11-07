import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, basename, join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import type { RsiOptimizerSession } from '../../src/core/rsi-types.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { DockerClient } from './docker.js';
import { isolationArgs, mustDocker, successful } from './docker.js';
import { git, importCommit } from './build.js';
import { extractFiles, packFiles, privateWrite, unpackFiles } from './artifacts.js';
import { putTar } from './evaluator.js';
import { renderOptimizerRun, optimizerVolume } from './optimizer-profile.js';
import type { RsiOptimizerProfile } from './optimizer-profile.js';
import type { WorkerSettings } from './worker.js';
import type { RsiStore } from './queue.js';
import { now } from './queue.js';
import { selectedParent } from './commands.js';
import { handoffPrompt } from './handoff-prompt.js';
import type { RsiSessionEndReason, RsiSessionReport } from '../../src/core/rsi-types.js';
import { startProxy, stopProxy, exportProxyArtifacts, readProxyUsage } from './proxy-run.js';
import type { UsageReceipt } from './proxy-run.js';

/** Normalized USTAR entries for a shallow clone's objects, source-sized (the generic artifact packer caps64MiB). */
async function shallowSourceTar(clone: string): Promise<Buffer> {
  const names=['.git/shallow',...(await readdir(join(clone,'.git/objects/pack'))).map(file=>`.git/objects/pack/${file}`)],chunks:Buffer[]=[];let size=0;
  for(const name of names){
    const bytes=await readFile(join(clone,name));size+=bytes.length;if(size>256*1024*1024)throw new Error('Optimizer source exceeds256MiB');
    const header=Buffer.from(packFiles(new Map([[name,Buffer.alloc(0)]])).subarray(0,512));
    header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124,12,'ascii');header.fill(32,148,156);
    const sum=header.reduce((n,b)=>n+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
    chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  return Buffer.concat([...chunks,Buffer.alloc(1024)]);
}
export async function revokeAgentSession(root: string): Promise<void> {
  try { await unlink(join(root, 'private/agent-session.json')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}
export async function issueAgentSession(root: string, sessionId: string, timeoutMs: number): Promise<string> {
  const token = randomBytes(32).toString('hex'), file = join(root, 'private/agent-session.json');
  await privateWrite(`${file}.tmp`, JSON.stringify({ sessionId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + timeoutMs).toISOString() }));
  await rename(`${file}.tmp`, file); return token;
}
/** Only native counters; never infer tokens from bytes. Input is bounded tar entries. */
export async function selfReportedTokens(files: Map<string, Buffer>, family: string): Promise<number | null> {
  let total = 0, found = false; const messages = new Map<string,number>();
  for (const [name, bytes] of files) {
    if (!name.endsWith('.jsonl')) continue;
    let codex = 0;
    for await (const line of createInterface({ input: Readable.from([bytes]), crlfDelay: Infinity })) {
      let v: Record<string, unknown>; try { v = JSON.parse(line); } catch { continue; }
      if (family === 'openai') {
        const payload = v.payload as { type?: string; info?: { total_token_usage?: { total_tokens?: number } } } | undefined;
        const n = payload?.type === 'token_count' ? payload.info?.total_token_usage?.total_tokens : undefined;
        if (Number.isSafeInteger(n) && n! >= 0) { codex = Math.max(codex, n!); found = true; }
      } else if (family === 'anthropic') {
        const message = v.message as { id?: string; usage?: Record<string, number> } | undefined;
        if (!message?.id || !message.usage || !['input_tokens','output_tokens'].some(k => Object.hasOwn(message.usage!,k))) continue;
        const counters = ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].map(k => message.usage![k] ?? 0);
        if (counters.every(n => Number.isSafeInteger(n) && n >= 0)) { messages.set(message.id,Math.max(messages.get(message.id)??0,counters.reduce((a,b)=>a+b,0))); found = true; }
      }
    }
    total += codex;
  }
  total += [...messages.values()].reduce((a,b)=>a+b,0);
  return found && Number.isSafeInteger(total) ? total : null;
}
export function consecutiveNoSubmissions(sessions: RsiOptimizerSession[]): number {
  let count = 0;
  for (const s of [...sessions].sort((a,b) => b.seq-a.seq)) {
    if (s.state === 'running') continue;
    if (!['no_submission','timeout'].includes(s.state)) break;
    count++;
  }
  return count;
}
function optimizerUserClient(client: DockerClient, user: string, home?: string): DockerClient {
  if(!user||!/^[A-Za-z0-9_.:-]+$/.test(user)||['root','0'].includes(user.split(':')[0]!))throw new Error('Optimizer image requires a non-root USER');
  return {run:(argv,options)=>client.run(argv[0]==='exec'?['exec','--user',user,...(home?['--env',`HOME=${home}`]:[]),...argv.slice(1)]:argv,options)};
}
async function optimizerExecutionClient(client: DockerClient, name: string, user: string): Promise<DockerClient> {
  const base=optimizerUserClient(client,user);
  if(!/^[1-9]\d*$/.test((await mustDocker(base,['exec',name,'id','-u'])).toString().trim()))throw new Error('Optimizer code must not run as root');
  const home=(await mustDocker(base,['exec',name,'sh','-c','uid=$(id -u); while IFS=: read -r name pass entry_uid group full home shell; do if test "$entry_uid" = "$uid"; then printf %s "$home"; exit 0; fi; done < /etc/passwd; exit 125'])).toString();
  if(!home.startsWith('/')||posix.normalize(home)!==home||/[\0\r\n]/.test(home))throw new Error('Optimizer user requires a container home');
  return optimizerUserClient(client,user,home);
}
const IDLE_CPU_PERCENT = 2, IDLE_QUIET_SAMPLES = 3, IDLE_SAMPLE_MS = 20000, SNAPSHOT_LEAD_MS = 30000, AGENT_OUTPUT_BYTES = 131072;
/** A session is idle once it stops making model requests and stops using CPU: a long test run stays busy and is left alone. */
export class IdleWatch {
  readonly limitMs: number; readonly sampleCpu: () => Promise<number | null>; readonly clock: () => number;
  private requests = -1; private last: number; private next = 0; private quiet = 0;
  constructor(limitMs: number, sampleCpu: () => Promise<number | null>, clock: () => number = Date.now) {
    this.limitMs = limitMs; this.sampleCpu = sampleCpu; this.clock = clock; this.last = clock();
  }
  async idle(requests: number): Promise<boolean> {
    const at = this.clock();
    if (requests !== this.requests) { this.requests = requests; this.last = at; this.quiet = 0; return false; }
    if (at - this.last < this.limitMs || at < this.next) return false;
    this.next = at + Math.min(IDLE_SAMPLE_MS, this.limitMs);
    const cpu = await this.sampleCpu();
    if (cpu === null || cpu >= IDLE_CPU_PERCENT) { this.last = this.clock(); this.quiet = 0; return false; }
    return ++this.quiet >= IDLE_QUIET_SAMPLES;
  }
}
export function sessionEndReason(v: { action: string | null; idled: boolean; timedOut: boolean; tokenCapped: boolean; interrupted: boolean }): RsiSessionEndReason {
  return v.action === 'submit' ? 'submitted' : v.action ? 'declared_stuck' : v.idled ? 'idle' : v.timedOut ? 'deadline' : v.tokenCapped ? 'token_limit' : v.interrupted ? 'interrupted' : 'agent_exited';
}
const redact = (text: string, secrets: string[]): string => secrets.reduce((value, secret) => secret ? value.replaceAll(secret, '[redacted]') : value, text);
async function containerCpuPercent(client: DockerClient, name: string): Promise<number | null> {
  try {
    const r = await client.run(['stats', '--no-stream', '--format', '{{.CPUPerc}}', name], { timeoutMs: 15000, maxOutputBytes: 1024 });
    const value = successful(r) ? Number.parseFloat(r.stdout.toString()) : Number.NaN;
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}
/** Both views come from the engine rather than from a binary inside the untrusted container. */
export async function captureProcesses(client: DockerClient, name: string, secrets: string[]): Promise<Pick<RsiSessionReport, 'processes' | 'containerStats'>> {
  const text = async (argv: string[]): Promise<string | null> => {
    try { const r = await client.run(argv, { timeoutMs: 15000, maxOutputBytes: 65536 }); return successful(r) ? redact(r.stdout.toString(), secrets) : null; }
    catch { return null; }
  };
  const [processes, containerStats] = await Promise.all([text(['top', name, '-eo', 'pid,ppid,stat,etime,time,args']), text(['stats', '--no-stream', '--format', '{{json .}}', name])]);
  return { processes, containerStats };
}
/** docker cp also works after PID1 exits at the deadline, and never runs anything inside the container. */
export async function agentOutputTail(client: DockerClient, name: string, path: string, secrets: string[]): Promise<string | null> {
  try {
    const r = await client.run(['cp', `${name}:${path}`, '-'], { timeoutMs: 30000, maxOutputBytes: 64 * 1024 * 1024 });
    if (!successful(r)) return null;
    const files = [...unpackFiles(r.stdout).values()];
    return files.length === 1 ? redact(files[0]!.subarray(-AGENT_OUTPUT_BYTES).toString('utf8'), secrets) : null;
  } catch { return null; }
}
/** Stop every optimizer descendant, including processes that created a new session. */
export async function stopOptimizer(client: DockerClient, name: string, retryDelayMs = 500): Promise<void> {
  // SIGKILL is asynchronous: a large process can still be tearing down at the check, more so on a busy VM, so a live process is only final after retries.
  for(let attempt=0;attempt<20;attempt++){
    const stopped=await client.run(['exec',name,'sh','-c',
    'for round in 1 2 3 4 5 6 7 8; do for path in /proc/[0-9]*; do pid=${path##*/}; if test "$pid" != 1 && test "$pid" != "$$"; then kill -KILL "$pid" 2>/dev/null || true; fi; done; done; for path in /proc/[0-9]*; do pid=${path##*/}; if test "$pid" != 1 && test "$pid" != "$$" && test -r "$path/status"; then live=1; while read -r key value rest; do if test "$key" = State: && test "$value" = Z; then live=0; break; fi; done < "$path/status"; if test "$live" = 1; then exit 125; fi; fi; done'],{timeoutMs:10000});
    if(successful(stopped))return;
    if((await mustDocker(client,['inspect','--format','{{.State.Running}}',name])).toString().trim()==='false')return;
    await delay(retryDelayMs);
  }
  throw new Error('Optimizer processes did not stop');
}
export async function importSessionBundle(store: RsiStore, client: DockerClient, s: RsiOptimizerSession, queueId: string, commit: string): Promise<void> {
  const output=join(store.root,s.artifactPath),mirror=join(store.root,'private/repository.git');
  try {
    const existing=JSON.parse(await readFile(join(output,'imported.json'),'utf8')) as {commit:string;queueId:string};
    if(existing.commit!==commit||existing.queueId!==queueId)throw new Error('Optimizer import identity changed');
    await git(['--git-dir',mirror,'cat-file','-e',`${commit}^{commit}`]);
    await git(['--git-dir',mirror,'update-ref',`refs/rsi/submissions/${createHash('sha256').update(queueId).digest('hex')}`,commit]);return;
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const name=`rsi-optimizer-${s.id}`;
  const user=(await mustDocker(client,['inspect','--format','{{index .Config.Labels "rsi.optimizer-user"}}',name])).toString().trim();
  client=await optimizerExecutionClient(client,name,user);
  const work=`/tmp/rsi-${s.id}/source`,temp=await mkdtemp(join(tmpdir(),'rsi-recover-bundle-'));
  try{
    await stopOptimizer(client,name);
    // The clone is shallow, so the bundle carries only what is new on top of the parent, which the mirror already has.
    if(commit!==s.commit){
      await mustDocker(client,['exec','-w',work,name,'git','-c','core.hooksPath=/dev/null','update-ref','refs/rsi/submission',commit]);
      await mustDocker(client,['exec','-w',work,name,'git','-c','core.hooksPath=/dev/null','bundle','create','/tmp/candidate.bundle','refs/rsi/submission',`^${s.commit}`]);
      const archive=await mustDocker(client,['exec',name,'tar','-cf','-','-C','/tmp','candidate.bundle'],{maxOutputBytes:256*1024*1024});
      await extractFiles(archive,temp,true);await importCommit(join(temp,'candidate.bundle'),mirror,commit);
    }
    await git(['--git-dir',mirror,'merge-base','--is-ancestor',s.commit,commit]);
    await git(['--git-dir',mirror,'update-ref',`refs/rsi/submissions/${createHash('sha256').update(queueId).digest('hex')}`,commit]);
    const manifest=join(output,'imported.json');await privateWrite(`${manifest}.tmp`,JSON.stringify({commit,queueId}));await rename(`${manifest}.tmp`,manifest);
  }finally{await rm(temp,{recursive:true,force:true});}
}
export async function recoverOptimizerSessions(store: RsiStore, client?: DockerClient): Promise<void> {
  await revokeAgentSession(store.root);
  for (const s of store.list('session_put').filter(s => s.state === 'running')) {
    const q = store.list('queue_put').filter(q => q.requestedBy === 'optimizer' && q.createdAt >= s.startedAt && ['submit','declare_stuck'].includes(q.command.action)).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
    let accepted=q;
    if(q?.command.action==='submit'){
      try{
        if(!client)throw new Error('Recovery requires Docker transport');
        await importSessionBundle(store,client,s,q.id,q.command.commit);
      }catch{
        // No verified commit means no candidate may be evaluated. Preserve the
        // failed request and interrupted session for human inspection.
        await store.put({event:'queue_put',payload:{...q,state:'failed',updatedAt:now()}});accepted=undefined;
      }
    }
    await store.put({ event: 'session_put', payload: { ...s, state: accepted?.command.action === 'submit' ? 'submitted' : accepted ? 'stuck' : 'interrupted', submissionId: accepted?.id ?? null, endedAt: now() } });
  }
}
export async function runOptimizerSession(store: RsiStore, client: DockerClient, profile: RsiOptimizerProfile,
  image: string, settings: WorkerSettings, account: (receipt: UsageReceipt) => Promise<void>, signal?: AbortSignal): Promise<void> {
  const unmetered = profile.egress.kind === 'vendor-allowlist';
  if (unmetered && !settings.allowUnmeteredOptimizer) throw new Error('Vendor CONNECT cannot enforce token budgets. Set WorkerSettings.allowUnmeteredOptimizer=true or --allow-unmetered-optimizer to run with a hard time limit and self_reported diagnostics.');
  const id = randomUUID(), parentId = selectedParent(store), parent = store.list('iteration_put').find(i => i.id === parentId)?.commit ?? store.task().baselineCommit;
  const session: RsiOptimizerSession = { id, taskId: store.taskId, seq: Math.max(0,...store.list('session_put').map(s => s.seq))+1, parentId, commit: parent,
    state: 'running', submissionId: null, accounting: unmetered ? 'self_reported' : 'proxy', tokens: null, artifactPath: `artifacts/optimizer/${id}`, startedAt: now(), endedAt: null };
  await store.put({ event: 'session_put', payload: session });
  const timeout = settings.optimizerSessionTimeoutMs ?? 1800000, limit = store.task().config.optimizerSessionTokens ?? settings.optimizerSessionTokens ?? 2000000, idleLimit = settings.optimizerIdleTimeoutMs ?? 600000;
  const token = await issueAgentSession(store.root, id, timeout), output = join(store.root, session.artifactPath);
  const runId = createHash('sha256').update(`optimizer:${id}`).digest('hex'), mirror = join(store.root,'private/repository.git');
  const temp = await mkdtemp(join(tmpdir(),'rsi-optimizer-')), name = `rsi-optimizer-${id}`;
  let userClient: DockerClient=client;
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined, created = false, stopped = false, timedOut = false;
  const previousLogs=new Map<string,number>();let nativeSnapshot=false;
  let tokens: number | null = null, pollFailure: unknown, polling = true, intervened = false, idled = false, tokenCapped = false, requests: number | null = null;
  let snapshot: Pick<RsiSessionReport, 'processes' | 'containerStats'> | null = null;
  const controller = new AbortController(), abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); void revokeAgentSession(store.root).catch(e => { pollFailure = e; }); }, timeout); deadline.unref();
  let monitor: Promise<void> = Promise.resolve(), finished: RsiOptimizerSession | null = null;
  try {
    await mkdir(output, { recursive: true, mode: 0o700 });
    proxy = await startProxy(client, store.taskId, runId, 'optimizer', 0, Math.min(limit, Math.max(1, store.task().config.maxTaskTokens-store.task().tokenUsage)),
      unmetered ? { ...settings.proxy, mode: 'mock' } : settings.proxy, controller.signal, { apiBase: settings.apiBase ?? 'http://127.0.0.1:4173', redactionHashes: [store.task().taskTokenHash,createHash('sha256').update(token).digest('hex')], domains: profile.egress.kind === 'vendor-allowlist' ? profile.egress.domains : [] });
    // Only the parent commit travels: a real repository's history can dwarf its tree and the optimizer needs just the code.
    // git clone only fetches refs/heads/*, so the parent must travel under a branch ref.
    const ref = `refs/heads/rsi-session-${id}`, shallow = join(temp,'source');
    await git(['--git-dir',mirror,'update-ref',ref,parent]);
    await git(['clone','-q','--no-checkout','--depth','1','--no-tags','--template=','--branch',`rsi-session-${id}`,`file://${mirror}`,shallow]);
    await git(['--git-dir',mirror,'update-ref','-d',ref]);
    const model = settings.proxy.mode === 'mock' ? 'fixed' : process.env.RSI_UPSTREAM_MODEL!;
    const rendered = renderOptimizerRun(profile, handoffPrompt(), model, proxy.token);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, DOCKER_CONFIG: process.env.DOCKER_CONFIG,
      RSI_API_BASE: 'http://rsi-proxy:8080/api/rsi/agent', RSI_AGENT_TOKEN: token, ...rendered.env,
      ...(unmetered ? { HTTP_PROXY: 'http://rsi-proxy:8080', HTTPS_PROXY: 'http://rsi-proxy:8080' } : {}) };
    const keys = Object.keys(env).filter(k => !['PATH','DOCKER_CONFIG'].includes(k));
    const mount = profile.login.kind === 'volume' ? ['--mount',`type=volume,src=${optimizerVolume(profile.id)},dst=${profile.login.path}`] : [];
    const user=(await mustDocker(client,['image','inspect','--format','{{.Config.User}}',image])).toString().trim();
    userClient=optimizerUserClient(client,user);
    const expires=String(Math.floor((Date.parse(session.startedAt)+timeout)/1000));
    await mustDocker(client,['create',...isolationArgs(proxy.network,store.taskId,name),...mount,'--user','0','--label',`rsi.optimizer-user=${user}`,'--entrypoint','sh',...keys.flatMap(k => ['-e',k]),image,'-c','now=$(date +%s); delay=$(($1-now)); if test "$delay" -gt 0; then exec sleep "$delay"; fi','rsi',expires],{env,signal:controller.signal}); created=true;
    await mustDocker(client,['start',name],{signal:controller.signal});
    const networks = JSON.parse((await mustDocker(client,['inspect','--format','{{json .NetworkSettings.Networks}}',name])).toString()) as Record<string,unknown>;
    const mounts = JSON.parse((await mustDocker(client,['inspect','--format','{{json .Mounts}}',name])).toString()) as { Type: string; Name: string; Destination: string }[];
    if (Object.keys(networks).length!==1 || !Object.hasOwn(networks,proxy.network) || mounts.length !== (profile.login.kind==='volume'?1:0)
      || mounts.some(m => profile.login.kind!=='volume' || m.Type!=='volume' || m.Name!==optimizerVolume(profile.id) || m.Destination!==profile.login.path)) throw new Error('Optimizer isolation violation');
    userClient=await optimizerExecutionClient(client,name,user);
    const work = `/tmp/rsi-${id}`;
    await putTar(userClient,name,`${work}/source`,await shallowSourceTar(shallow),controller.signal);
    for (const file of rendered.files) await putTar(userClient,name,dirname(file.path),packFiles(new Map([[basename(file.path),Buffer.from(file.content)]])),controller.signal);
    await mustDocker(userClient,['exec','-w',`${work}/source`,name,'git','-c','core.hooksPath=/dev/null','init','-q'],{signal:controller.signal});
    const exec = (argv: string[], extra = {}) => mustDocker(userClient,['exec','-w',`${work}/source`,name,...argv],extra);
    await exec(['git','config','core.hooksPath','/dev/null']); await exec(['git','checkout','-q',parent]);
    await exec(['git','config','user.name','RSI Optimizer']); await exec(['git','config','user.email','rsi@localhost']);
    if(unmetered) {
      try { const prior=await mustDocker(userClient,['exec',name,'sh','-c','if test -d "$1"; then tar -cf - -C "$1" .; else tar -cf - -T /dev/null; fi','rsi',profile.session.dir],{maxOutputBytes:64*1024*1024}); nativeSnapshot=true; for(const [path,bytes] of unpackFiles(prior)) if(path.endsWith('.jsonl')) previousLogs.set(path,bytes.length); }
      catch { previousLogs.clear(); }
    }
    const secrets = [token, proxy.token], agentOutput = `${work}/agent-output.log`, watch = new IdleWatch(idleLimit, () => containerCpuPercent(client, name));
    monitor = (async () => {
      while (polling && !controller.signal.aborted) {
        try {
          await store.refresh();
          if (!unmetered) {
            const receipt=await readProxyUsage(client,proxy!.name,runId); tokens=receipt.tokens; requests=receipt.requests; await account(receipt);
            if(receipt.blocked || receipt.tokens>=limit) { tokenCapped=true; controller.abort(); }
            else if(await watch.idle(receipt.requests)) { idled=true; timedOut=true; controller.abort(); }
          }
          // PID1 exits at the deadline and takes the processes with it, so the last look happens just before.
          if(!snapshot && Date.now()>=Date.parse(session.startedAt)+timeout-SNAPSHOT_LEAD_MS) snapshot=await captureProcesses(client,name,secrets);
          const q=store.list('queue_put').find(q => q.requestedBy==='optimizer' && q.createdAt>=session.startedAt && ['submit','declare_stuck'].includes(q.command.action));
          intervened=store.list('queue_put').some(q=>q.requestedBy==='human'&&q.state==='queued'&&['pause','stop','rollback'].includes(q.command.action));
          if(q || intervened || store.task().state!=='running') controller.abort();
        } catch(e) { pollFailure=e; controller.abort(); }
        // Must stay referenced: once the session exec ends, this timer alone keeps the worker alive until polling stops.
        if(polling && !controller.signal.aborted) await new Promise<void>(resolve => { setTimeout(resolve,200); });
      }
    })();
    // Only PID1 and the trusted export commands survive session termination.
    await userClient.run(['exec','-w',`${work}/source`,name,'sh','-c','out=$1; shift; "$@" >"$out" 2>&1','rsi',agentOutput,...rendered.argv],{signal:controller.signal,timeoutMs:timeout,maxOutputBytes:1024});
    if(Date.now()>=Number(expires)*1000)timedOut=true;
    polling=false; await monitor;
    await revokeAgentSession(store.root);
    if(idled) snapshot=await captureProcesses(client,name,secrets);
    await stopOptimizer(userClient,name); stopped=true;
    await store.refresh();
    const q=store.list('queue_put').filter(q => q.requestedBy==='optimizer' && q.createdAt>=session.startedAt && ['submit','declare_stuck'].includes(q.command.action)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))[0];
    if(q?.command.action==='submit') await importSessionBundle(store,client,session,q.id,q.command.commit);
    if(unmetered && nativeSnapshot) {
      try { const archive=await mustDocker(userClient,['exec',name,'tar','-cf','-','-C',profile.session.dir,'.'],{maxOutputBytes:64*1024*1024}); const files=unpackFiles(archive);for(const [path,bytes] of files){const offset=previousLogs.get(path)??0;if(bytes.length>=offset)files.set(path,bytes.subarray(offset));}tokens=await selfReportedTokens(files,profile.family); }
      catch { tokens=null; }
    }
    finished={...session,state:q?.command.action==='submit'?'submitted':q?'stuck':timedOut?'timeout':signal?.aborted||intervened?'interrupted':'no_submission',submissionId:q?.id??null,tokens,endedAt:now()};
    if(!unmetered) try { const last=await readProxyUsage(client,proxy.name,runId); requests=last.requests; tokenCapped||=last.blocked||last.tokens>=limit; } catch { /* the receipt below stays authoritative for accounting */ }
    // Why a round ended is diagnostics: failing to record it must not change how the round ended.
    try {
      const report: RsiSessionReport={endReason:sessionEndReason({action:q?.command.action??null,idled,timedOut,tokenCapped,interrupted:!!signal?.aborted||intervened}),tokenLimit:limit,requests,idleLimitMs:idleLimit,processes:snapshot?.processes??null,containerStats:snapshot?.containerStats??null};
      await privateWrite(join(output,'session-report.json'),JSON.stringify(report,null,2));
      const text=await agentOutputTail(client,name,agentOutput,secrets);
      if(text!==null) await privateWrite(join(output,'agent-output.log'),text);
    } catch { /* see above */ }
    if(pollFailure) throw pollFailure;
  } finally {
    clearTimeout(deadline); await revokeAgentSession(store.root); polling=false; await monitor;
    signal?.removeEventListener('abort',abort);
    if(created) {
      try { if(!stopped) await stopOptimizer(userClient,name); }
      finally { await mustDocker(client,['rm','-f',name]); }
    }
    if(proxy) {
      const receipt=await readProxyUsage(client,proxy.name,runId,true); if(!unmetered) { tokens=receipt.tokens; await account(receipt); }
      await exportProxyArtifacts(client,proxy,output); await stopProxy(client,proxy);
    }
    await rm(temp,{recursive:true,force:true});
    const current=store.list('session_put').find(s=>s.id===id);
    if(current?.state==='running' && !finished) {
      for(const q of store.list('queue_put').filter(q=>q.requestedBy==='optimizer'&&q.createdAt>=current.startedAt&&q.command.action==='submit'&&q.state==='queued')) await store.put({event:'queue_put',payload:{...q,state:'failed',updatedAt:now()}});
    }
    if(current?.state==='running') await store.put({event:'session_put',payload:finished ? {...finished,tokens,endedAt:now()} : {...current,state:timedOut?'timeout':'interrupted',submissionId:null,tokens,endedAt:now()}});
  }
}
