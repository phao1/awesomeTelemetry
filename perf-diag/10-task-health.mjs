// Actual collector + pure engine worker, 20,000 retained events / five members.
// No ports, source hydration, external requests, saved reports or installed deps.
import { build } from 'vite';
import Database from 'better-sqlite3';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'health-perf-'));
let db;
try {
  await build({ configFile: false, logLevel: 'silent', build: { ssr: true, outDir: directory, emptyOutDir: false, target: 'node20', rollupOptions: { input: { collector: join(root, 'server/task-health/collector.ts'), schema: join(root, 'server/storage/schema.ts') }, external: ['better-sqlite3'], output: { entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' } } } });
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  const { initSchema } = await import(pathToFileURL(join(directory, 'schema.mjs')).href);
  const { collectTaskHealth, generateHealthReport } = await import(pathToFileURL(join(directory, 'collector.mjs')).href);
  db = new Database(':memory:'); initSchema(db);
  const when = '2026-10-30T00:00:00.000Z';
  db.prepare("INSERT INTO team_runs(id,provider,native_run_id,updated_at,stamp) VALUES('run','codex','native-main',?,?)").run(when, when);
  const session = db.prepare('INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded,status,data_source,event_count) VALUES(?,?,?,?,?,?,?,1,?,?,4000)');
  const agent = db.prepare('INSERT INTO team_agents(id,run_id,native_id,display_name,role_class,session_keys_json) VALUES(?,?,?,?,?,?)');
  const event = db.prepare('INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,status,actor,input_len,output_len,turn_key,duration_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const source = db.prepare("INSERT INTO trace_identity_sources(id,session_key,parser_version,complete,omitted_count,reasons_json,content_sha256,updated_at) VALUES(?,?,3,1,0,'[]','fixture',?)");
  const identity = db.prepare('INSERT INTO trace_identities(id,source_id,namespace,kind,value,scope,event_id,source_path) VALUES(?,?,?,?,?,?,?,?)');
  // 1,000 meaningful decision rounds amid real-world bookkeeping density;
  // tooling remains within the existing 2,000 model/tool-span cap.
  db.transaction(() => {
    for (let m = 0; m < 5; m++) {
      const id = m === 0 ? 'main' : 'child' + m;
      session.run(id, 'codex', 'Codex', id, when, '2026-10-30T01:06:40.000Z', join(directory, id + '.jsonl'), 'success', 'scan');
      agent.run('agent' + m, 'run', m === 0 ? 'native-main' : 'native-' + id, id, m === 0 ? 'leader' : 'subagent', JSON.stringify([id]));
      source.run('scan:' + id, id, when);
      for (let i = 0; i < 4000; i++) {
        const kind = i === 0 ? 'user_prompt' : i % 20 === 1 ? 'llm' : [2, 3].includes(i % 20) ? 'tool' : 'system';
        event.run(id, 'e' + i, i, kind, 'implement', kind === 'tool' ? 'read_file' : kind, new Date(Date.parse(when) + i * 1000).toISOString(), 'success', 'assistant', i % 20 === 2 ? 5 : 0, kind === 'llm' || i % 20 === 3 ? 5 : 0, id + ':turn:' + Math.floor(i / 20), kind === 'tool' ? 100 : 0);
        if (kind === 'llm' || kind === 'tool') identity.run(id + ':turn:' + i, 'scan:' + id, 'agent:codex', 'turn', 'turn' + Math.floor(i / 20), id, 'e' + i, 'payload.turn_id');
        if (kind === 'tool') identity.run(id + ':tool:' + i, 'scan:' + id, 'protocol:openai', 'tool_call', 'call' + Math.floor(i / 20), id, 'e' + i, 'payload.call_id');
      }
    }
  })();
  for (let m = 0; m < 5; m++) await writeFile(join(directory, (m === 0 ? 'main' : 'child' + m) + '.jsonl'), '');
  let network = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { network++; throw new Error('External request forbidden'); };
  const histogram = monitorEventLoopDelay({ resolution: 1 }); histogram.enable(); await delay(10);
  try {
    const started = performance.now(), input = await collectTaskHealth(db, 'collected:main');
    const collectedMs = performance.now() - started;
    const report = await generateHealthReport(input), elapsedMs = performance.now() - started;
    await delay(10); histogram.disable();
    const loopP99Ms = histogram.percentile(99) / 1e6, loopMaxMs = histogram.max / 1e6, bytes = Buffer.byteLength(JSON.stringify(report));
    const result = { events: input.records.length, members: input.members.length, spans: report.spans.length, collectedMs, elapsedMs, loopP99Ms, loopMaxMs, bytes, externalRequests: network, limits: report.coverage.limits };
    console.log(JSON.stringify(result));
    if (input.records.length !== 20000 || input.members.length !== 5 || elapsedMs > 3000 || loopP99Ms >= 50 || loopMaxMs >= 50 || bytes > 1024 * 1024 || network !== 0) throw new Error('Task health performance budget exceeded');
  } finally { histogram.disable(); globalThis.fetch = originalFetch; }
} finally { db?.close(); await rm(directory, { recursive: true, force: true }); }
