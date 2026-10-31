#!/usr/bin/env node
// Explicit synthetic acceptance only. Reuses the owned tools demo and its isolated config.
import { access, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(tmpdir(), 'awesomeTelemetry-tools-acceptance');
const marker = JSON.parse(await readFile(join(directory, 'SYNTHETIC-TOOLS-DEMO.json'), 'utf8'));
if (marker.fixture !== 'native-tools-v1' || marker.synthetic !== true) throw new Error('Expected the existing isolated synthetic tools fixture');
await access(join(root, 'server-dist/cli.js'));
const keys = JSON.parse(await readFile(join(directory, 'session-keys.json'), 'utf8'));
const runtimeDirectory = join(directory, '.functional-runtime');
await mkdir(runtimeDirectory, { recursive: true });
const entry = join(runtimeDirectory, 'entry.mjs');
const imports = {
  openWritable: 'server/storage/db.ts', initSchema: 'server/storage/schema.ts',
  insertFridaCapture: 'server/storage/frida-captures.ts',
  writeNativeIdentities: 'server/storage/trace-links.ts',
  extractNetworkIdentities: 'server/proxy/identity-extractor.ts',
  writeCaptureTransport: 'server/proxy/capture-storage.ts',
};
await writeFile(entry, Object.entries(imports).map(([name, path]) => 'export { ' + name + ' } from ' + JSON.stringify(join(root, path)) + ';').join('\n'));
await build({ configFile: false, root, logLevel: 'error', build: { ssr: entry, outDir: runtimeDirectory, emptyOutDir: false,
  target: 'node20', rollupOptions: { external: ['better-sqlite3', 'chokidar', 'http-mitm-proxy', 'node-forge'], output: { entryFileNames: 'runtime.mjs' } } } });
try { await symlink(join(root, 'node_modules'), join(runtimeDirectory, 'node_modules'), 'dir'); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const runtime = await import(pathToFileURL(join(runtimeDirectory, 'runtime.mjs')).href);
const db = runtime.openWritable(join(directory, 'demo.sqlite'));
try {
  runtime.initSchema(db);
  const selected = db.prepare('SELECT id FROM sessions WHERE id=?').get(keys['tools-main']);
  if (!selected) throw new Error('The existing synthetic native session is required');
  const run = 'SYNTHETIC-FUNCTIONAL-2';
  if (!db.prepare('SELECT id FROM frida_captures WHERE capture_session_id=? LIMIT 1').get(run)) {
    runtime.insertFridaCapture(db, { pid: 123, model: null, sessionId: null,
      jsonData: JSON.stringify({ synthetic: true, source: 'controlled fixture, not a real Frida target', message: '合成保存详情；不运行任何真实工具。', literal: '<script>仅原样日志文字，不执行</script>' }) }, run);
  }
  const requestId = 'SYNTHETIC-FUNCTIONAL-2-PROXY';
  if (!db.prepare('SELECT id FROM proxy_requests WHERE request_id=?').get(requestId)) {
    const startedAt = new Date(Date.now() - 2000).toISOString(), completedAt = new Date().toISOString();
    const requestBody = JSON.stringify({ metadata: { synthetic: true }, messages: [] });
    const responseBody = JSON.stringify({ id: 'synthetic-response-functional-2', choices: [{ message: { tool_calls: [{ id: 'call_demo_A', type: 'function', function: { name: 'read_file', arguments: '{"synthetic":true}' } }] } }] });
    db.transaction(() => {
      const result = db.prepare('INSERT INTO proxy_requests (request_id,method,url,hostname,started_at,completed_at,duration_ms,capture_method,request_format,request_body,response_body) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(requestId, 'POST', '/v1/chat/completions', 'synthetic.invalid', startedAt, completedAt, 2000, 'mitm', 'openai_chat', requestBody, responseBody);
      const id = Number(result.lastInsertRowid);
      runtime.writeNativeIdentities(db, { source: 'proxy', key: String(id) }, runtime.extractNetworkIdentities({ format: 'openai_chat',
        requestHeaders: { 'x-agent-provider': 'codex', 'x-agent-session-id': 'native-tools-main' }, requestBody, responseBody }), completedAt);
      runtime.writeCaptureTransport(db, id, { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
        timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150, firstContentMs: 800, firstContentKind: 'text',
          firstContentBasis: 'json_document_complete', completedMs: 2000, contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false } });
    })();
  }
  console.log('SYNTHETIC functional fixtures retained; no real Frida/CDP/Agent was launched.');
} finally { db.close(); }
// Existing launcher verifies synthetic marker and disabled real scanners, then uses one chosen port.
await import('./demo-tool-execution.mjs');
