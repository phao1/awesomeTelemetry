// Claude runs this OUTSIDE the Codex sandbox. Real Docker, HTTP and sidecar;
// scripted model transport, no monitor bypass and no host credential directories.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command, must } from './p2-smoke.mjs';

export function argumentsFor(args) {
  const flags={};
  for(let i=0;i<args.length;i+=2){if(!['--root','--docker-context','--report'].includes(args[i])||!args[i+1]||flags[args[i]])throw new Error('Usage: p4-loop.mjs [--root <new-dir>] [--docker-context <name>] [--report <json>]');flags[args[i]]=args[i+1];}
  return flags;
}
export async function main(args) {
  const flags=argumentsFor(args),root=flags['--root']?resolve(flags['--root']):await mkdtemp(join(tmpdir(),'rsi-p4-e2e-'));
  await mkdir(root,{recursive:true});
  const context=flags['--docker-context'],docker=argv=>must('docker',[...(context?['--context',context]:[]),...argv]);
  const report={version:1,startedAt:new Date().toISOString(),finishedAt:null,verdict:'infra_error',checks:{},errors:[]};
  const reportFile=flags['--report']?resolve(flags['--report']):join(root,'p4-report.json');
  let apiChild,workerChild,probe;
  try{
    assert.equal((await docker(['info','--format','{{.OSType}}'])).trim(),'linux','Linux Docker engine required');
    // Build a trusted test entry, not a clean-review provider or production endpoint.
    const harness=join(root,'harness.mjs'),buildRoot=join(root,'build');await mkdir(buildRoot,{recursive:true});
    const quote=p=>JSON.stringify(resolve(p));
    await writeFile(harness,`import http from 'node:http';
import {registerRsiRoutes} from ${quote('server/http/rsi-routes.ts')};
import {Router} from ${quote('server/http/router.ts')};
import {runRsiCli} from ${quote('server/rsi/cli.ts')};
if(process.env.RSI_P4_ROLE==='api'){
 const router=new Router(),stop=registerRsiRoutes(router,process.env.RSI_P4_DATA);
 const server=http.createServer(async(req,res)=>{const match=router.match(req.method,new URL(req.url,'http://localhost').pathname);if(!match){res.writeHead(404);res.end();return;}await match.handler(req,res,match.params);});
 server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
 process.on('SIGTERM',()=>{server.close(async()=>{await stop();process.exit(0);});});
}else await runRsiCli(JSON.parse(process.env.RSI_P4_ARGS));
`,{mode:0o600});
    const {build}=await import('vite');
    await build({configFile:false,logLevel:'error',build:{ssr:harness,outDir:buildRoot,emptyOutDir:false,target:'node24',rollupOptions:{external:['better-sqlite3','chokidar'],output:{entryFileNames:'harness.mjs'}}}});
    await symlink(resolve('node_modules'),join(buildRoot,'node_modules'),'dir');
    const env={PATH:process.env.PATH,DOCKER_CONFIG:process.env.DOCKER_CONFIG,RSI_P4_DATA:join(root,'awesome-telemetry-data/rsi'),RSI_P4_ROLE:'api'};
    const api=command(process.execPath,[join(buildRoot,'harness.mjs')],{env,ipc:true,timeoutMs:3600000});apiChild=api.child;
    const [message]=await once(api.child,'message'),base=`http://127.0.0.1:${message.port}`;
    const call=async(method,path,token,body)=>{
      const response=await fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      const value=await response.json();assert(response.ok,JSON.stringify({status:response.status,value}));return value;
    };
    const pageToken=(await call('GET','/api/rsi/session')).token;
    const repository=join(root,'mini-source');await cp(resolve('rsi-agents/mini-agent/source'),repository,{recursive:true});
    const git=argv=>must('git',['-c','core.hooksPath=/dev/null','-c','user.name=RSI','-c','user.email=rsi@localhost','-C',repository,...argv]);
    await git(['init','-q']);await git(['add','-A']);await git(['commit','-qm','baseline']);const baseline=(await git(['rev-parse','HEAD'])).trim();
    probe=http.createServer((_req,res)=>res.end('host-loopback-service'));
    probe.listen(0,'127.0.0.1');await once(probe,'listening');const probePort=probe.address().port;
    assert.equal(await(await fetch(`http://127.0.0.1:${probePort}`)).text(),'host-loopback-service');
    const optimizer=join(root,'scripted');await cp(resolve('rsi-agents/optimizers/scripted'),optimizer,{recursive:true});
    const profile=JSON.parse(await readFile(join(optimizer,'profile.json'),'utf8'));
    const isolation=`
for host in host.lima.internal host.docker.internal 192.168.5.2; do
  if curl -fsS --connect-timeout 1 --max-time 2 "http://$host:${probePort}" >/dev/null 2>&1; then exit 41; fi
done
status=$(curl -s -o /dev/null -w '%{http_code}' http://rsi-proxy:8080/api/rsi/session)
test "$status" = 404
status=$(curl -s -o /dev/null -w '%{http_code}' http://rsi-proxy:8080/api/health)
test "$status" = 404
if curl -fsS --max-time 2 -x http://rsi-proxy:8080 "https://192.168.5.2:${probePort}" >/dev/null 2>&1; then exit 42; fi
`;
    profile.run.files[0].content=profile.run.files[0].content.replace('set -eu','set -eu\n'+isolation).replace('# Every round',`if test "$seq" -gt 3; then
 curl -fsS -H "Authorization: Bearer $RSI_AGENT_TOKEN" -H 'Content-Type: application/json' -d '{"requestId":"loop-complete","reason":"Three complete hypotheses tested; human ideas requested"}' "$RSI_API_BASE/stuck" >/dev/null
 exit 0
fi
# Every round`);
    await writeFile(join(optimizer,'profile.json'),JSON.stringify(profile));
    const config={noiseRepeats:3,infraErrorMaxRatio:0.1,stableWindow:3,stableFailRepeats:2,sealedQueryBudget:10,tokenGrowthMaxRatio:0.3,maxIterations:10,maxTaskTokens:10000000,runTokenBudget:100000,targetPassedCount:100,l1:{maxDiffLines:2000,maxDiffBytes:262144,opaqueMinLength:512,minFingerprintLength:8,commonFingerprintRatio:0.5}};
    const created=await call('POST','/api/rsi/tasks',pageToken,{requestId:'p4-loop',repository,baselineCommit:baseline,bank:resolve('rsi-bank'),agentProfile:resolve('rsi-agents/mini-agent/profile.json'),optimizerProfile:join(optimizer,'profile.json'),subset:'small',config});
    const taskId=created.taskId,taskRoot=join(env.RSI_P4_DATA,taskId);
    const runtime=JSON.parse(await readFile(join(taskRoot,'private/runtime.json'),'utf8'));
    // Test-only trusted fake model setup. Both baseline/candidates intentionally
    // fail so each complete hypothesis is rejected before missing monitor holds.
    const manifest=JSON.parse(await readFile(join(taskRoot,'private/bank/manifest.json'),'utf8')),table={};
    for(const q of manifest.questions)table[q.id]={outcome:'fail',passCommand:'true',failCommand:'true'};
    runtime.proxy.mode='mock';runtime.proxy.mockTable=table;runtime.candidateMockTable=table;runtime.apiBase=base;runtime.optimizerSessionTimeoutMs=120000;runtime.agentTimeoutMs=120000;
    await writeFile(join(taskRoot,'private/runtime.json'),JSON.stringify(runtime),{mode:0o600});
    const workerEnv={...env,RSI_P4_ROLE:'worker',RSI_P4_ARGS:JSON.stringify(['worker','--execute','--watch','--task',taskId,'--root',root,...(context?['--docker-context',context]:[])])};
    const worker=command(process.execPath,[join(buildRoot,'harness.mjs')],{env:workerEnv,timeoutMs:3600000});workerChild=worker.child;
    let state;
    const deadline=Date.now()+45*60*1000;
    do{
      await new Promise(resolve=>setTimeout(resolve,1000));
      state=await call('GET',`/api/rsi/tasks/${taskId}`,pageToken);
      if(['needs_help','paused','stopped'].includes(state.task.state))break;
      assert(worker.child.exitCode===null,'worker exited before completion');
    }while(Date.now()<deadline);
    assert.equal(state.task.state,'needs_help');
    const iterations=(await call('GET',`/api/rsi/tasks/${taskId}/iterations`,pageToken)).items;
    assert.equal(iterations.length,3);assert(iterations.every(i=>i.state==='rejected'));
    const sessions=(await call('GET',`/api/rsi/tasks/${taskId}/sessions`,pageToken)).items;
    assert.equal(sessions.filter(s=>s.state==='submitted').length,3);assert.equal(sessions.filter(s=>s.state==='stuck').length,1);
    for(const iteration of iterations){const result=await call('GET',`/api/rsi/agent/iterations/${iteration.seq}/results`,created.agentToken);assert(result.quality.files>0);assert(!JSON.stringify(result).includes('sealedScore'));}
    const workerState=await call('GET',`/api/rsi/tasks/${taskId}/worker`,pageToken);assert(workerState.running);
    workerChild.kill('SIGINT');assert.equal((await worker.promise).code,0);
    assert.equal((await call('GET',`/api/rsi/tasks/${taskId}/worker`,pageToken)).running,false);
    assert.equal((await docker(['ps','-a','--filter',`label=awesome-telemetry.rsi=${taskId}`,'--format','{{.ID}}'])).trim(),'');
    assert.equal((await docker(['network','ls','--filter',`label=awesome-telemetry.rsi=${taskId}`,'--format','{{.ID}}'])).trim(),'');
    const ledger=await readFile(join(taskRoot,'ledger.jsonl'),'utf8');assert(!ledger.includes(created.agentToken));
    report.checks={realHttp:true,sidecarForwarding:true,threeCompleteIterations:true,hostLoopbackDenied:true,sessionRevocation:true,workerWatchAndCleanExit:true,cleanup:true};report.verdict='pass';
    apiChild.kill('SIGTERM');assert.equal((await api.promise).code,0);
  }catch(error){report.errors.push(error.message);process.exitCode=1;}
  finally{workerChild?.kill('SIGINT');apiChild?.kill('SIGTERM');probe?.close();}
  report.finishedAt=new Date().toISOString();await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({verdict:report.verdict,report:reportFile,errors:report.errors}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main(process.argv.slice(2));
