import { sourceBudget } from './source.js';
import * as linkedExecution from '../storage/linked-execution.js';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { claudeScanner } from '../../local-sessions/claude.js';
import { deriveSessionKey } from '../../local-sessions/session-key.js';
import { createNativeScopeCollector } from './native-scope.js';
import { collectFoldingMetricRun } from './run-metrics.js';
import { foldingRunMetrics } from '../../src/core/agent-folding-metrics.js';
it('sums root plus child usage, deduplicates snapshots and never turns inferred timing or prose into acceptance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folding-metrics-')), db = new Database(':memory:'); initSchema(db);
  const config = { key: 'claude' as const, enabled: false, path: dir, sourceKind: 'jsonl' as const, watchStrategy: 'chokidar' as const, pollIntervalMs: 0, label: 'Claude' };
  try {
    const timestamp = '2026-10-30T00:00:00.000Z', root = join(dir, 'root.jsonl'), child = join(dir, 'child.jsonl');
    const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 };
    const assistant = { type: 'assistant', sessionId: 'root', timestamp, message: { id: 'msg', model: 'test', usage, content: [{ type: 'tool_use', id: 'call', name: 'Agent', input: { subagent_type: 'reviewer' } }, { type: 'text', text: 'SECRET_BODY All tests passed' }] } };
    await writeFile(root, [assistant, assistant, { type: 'user', sessionId: 'root', timestamp: '2026-10-30T00:00:10.000Z', toolUseResult: { agentId: 'child' }, message: { content: [{ type: 'tool_result', tool_use_id: 'call', content: 'SECRET_RESULT' }] } }].map(r => JSON.stringify(r)).join('\n') + '\n');
    await writeFile(child, JSON.stringify({ type: 'assistant', sessionId: 'root', agentId: 'child', isSidechain: true, timestamp, message: { id: 'child-msg', model: 'test', usage, content: [{ type: 'text', text: 'SECRET_CHILD' }] } }) + '\n');
    await claudeScanner.scanFile(config, root, { db }); await claudeScanner.scanFile(config, child, { db });
    const id = 'collected:' + deriveSessionKey('claude', root), collector = createNativeScopeCollector(db);
    const project = await collector.collect({ taskIds: [id] });
    const run = await collectFoldingMetricRun(db, id, project), metrics = foldingRunMetrics(run);
    expect(metrics).toMatchObject({ input: 200, output: 40, cacheRead: 100, cacheWrite: 20, reasoning: null, tokens: 360, modelCalls: 2, toolCalls: 1, ttft: null, tpot: null, modelSum: null, toolSum: null, success: null, subAgents: 1, delegations: 1, linkCompleteness: 100 });
    expect(JSON.stringify(run)).not.toContain('SECRET'); expect(run.run.verdict).toBeNull();
    await expect(collectFoldingMetricRun(db, id, project, AbortSignal.abort())).rejects.toThrow();
    const { writeNativeIdentities, listTraceIdentities } = await import('../storage/trace-links.js');
    const { writeCaptureTransport } = await import('../proxy/capture-storage.js');
    const childKey = deriveSessionKey('claude', child);
    const identities = listTraceIdentities(db, { source: 'scan', key: childKey });
    const response = identities.items.find(i => i.kind === 'response')!;
    db.prepare("INSERT INTO proxy_requests (id,request_id,method,url,hostname,started_at,output_tokens) VALUES (1,'request','POST','/v1/messages','local.test',?,20)").run(timestamp);
    writeNativeIdentities(db, { source: 'proxy', key: '1' }, { parserVersion: 1, items: [
      { namespace: 'agent:claude', kind: 'session', value: 'child', scope: null, eventId: null, sourcePath: 'test.session' },
      { namespace: response.namespace, kind: response.kind, value: response.value, scope: response.scope, eventId: null, sourcePath: 'test.response' },
    ], completeness: { complete: true, omittedCount: 0, reasons: [] } }, timestamp);
    writeCaptureTransport(db, 1, { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
      timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 50, firstBodyByteMs: 80, firstContentMs: 100, completedMs: 500,
        firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false } });
    const measured = await collectFoldingMetricRun(db, id, project);
    expect(measured.run.telemetry!.spans.find(s => s.sessionKey === childKey && s.kind === 'model')).toMatchObject({ firstTokenMs: 100, durationMs: 500, timing: 'measured' });
    // Only the child has measured transport; partial timing must not become a whole-task average.
    expect(foldingRunMetrics(measured).ttft).toBeNull();
    // The indexed parent/child and exact call identity remain after either file is removed.
    await rm(child);
    const childMissing = await collectFoldingMetricRun(db, id, await collector.collect({ taskIds: [id] }));
    expect(childMissing.run.telemetry?.complete).toBe(false);
    expect(childMissing.limitations.join(' ')).toContain('indexed');
    expect(childMissing.run.telemetry?.usage.input).toBeGreaterThan(0);
    await rm(root);
    const indexedProject = await collector.collect({ taskIds: [id] });
    expect(indexedProject.traffic).toHaveLength(1);
    expect(indexedProject.evidence[0]?.complete).toBe(true);
    expect(indexedProject.agents.some(a => a.name === 'reviewer')).toBe(false);
    const rootMissing = await collectFoldingMetricRun(db, id, indexedProject);
    expect(rootMissing.run.telemetry?.complete).toBe(false);
    expect(rootMissing.recorded?.toolCalls).toBe(1);
    expect(rootMissing.run.telemetry?.usage.reasoning).toBeNull();
    expect(rootMissing.limitations.join(' ')).toContain('2 个成员');
    collector.close();
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

it.each([true,false])('uses final Codex cumulative usage with cache writes reported=%s', async reportedWrites => {
  const { codexScanner } = await import('../../local-sessions/codex.js');
  const dir = await mkdtemp(join(tmpdir(), 'folding-codex-metrics-')), db = new Database(':memory:'); initSchema(db);
  try {
    const file = join(dir, 'codex.jsonl'), timestamp = '2026-10-30T00:00:00.000Z';
    const usage = (input: number) => ({ input_tokens: input, output_tokens: 20, reasoning_output_tokens: 5, cached_input_tokens: 50, ...(reportedWrites?{cache_write_input_tokens:0}:{}) });
    await writeFile(file, [
      { type: 'session_meta', timestamp, payload: { id: 'codex-root', cwd: '/test' } },
      { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'TEST_ONLY' }] } },
      { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: usage(100) } } },
      { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'TEST_ONLY' }] } },
      { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: usage(200) } } },
      { type: 'response_item', timestamp, payload: { type: 'function_call', name: 'shell', call_id: 'tool-call', arguments: '{}' } },
      { type: 'response_item', timestamp, payload: { type: 'function_call_output', call_id: 'tool-call', output: 'TEST_ONLY' } },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    await codexScanner.scanFile({ key: 'codex', enabled: false, path: dir, sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Codex' }, file, { db });
    const id = 'collected:' + deriveSessionKey('codex', file), collector = createNativeScopeCollector(db), p = await collector.collect({ taskIds: [id] });
    const run = await collectFoldingMetricRun(db, id, p);
    expect(foldingRunMetrics(run)).toMatchObject({ input: 200, output: 20, reasoning: 5, tokens: 220, cacheHit:25, cacheRead: 50, modelCalls: null, toolCalls: 1, ttft: null });
    const pending = collectFoldingMetricRun(db, id, p);
    db.prepare('UPDATE sessions SET title=? WHERE id=?').run('changed', id.slice(10));
    await expect(pending).rejects.toMatchObject({ reason: 'SOURCE_CHANGED' });
    await rm(file);
    const indexed = await collectFoldingMetricRun(db, id, await collector.collect({ taskIds: [id] }));
    expect(indexed.run.telemetry).toMatchObject({ complete: false, usage: { input: 150, cacheRead: 50, cacheWrite: null, inputIncludesCache: false } });
    expect(foldingRunMetrics(indexed)).toMatchObject({tokens:220,cacheHit:25});
    expect(indexed.recorded).toMatchObject({ toolCalls: 1, modelCalls: null });
    expect(indexed.limitations.join(' ')).toContain('indexed');
    collector.close();
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

it('keeps complete counts and usage above 2000 spans, never pages unlinked or oversized linked events, and prefilters irrelevant lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folding-large-')), db = new Database(':memory:'); initSchema(db);
  const spy = vi.spyOn(linkedExecution, 'getLinkedExecution');
  try {
    const file = join(dir, 'root.jsonl'), timestamp = '2026-10-30T00:00:00.000Z';
    const lines = Array.from({ length: 2100 }, (_, i) => JSON.stringify({ type: 'assistant', sessionId: 'root', timestamp,
      message: { id: `msg-${i}`, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }, content: [{ type: 'tool_use', id: `call-${i}`, name: 'Bash', input: {} }] } }));
    await writeFile(file, lines.join('\n') + '\n');
    await claudeScanner.scanFile({ key: 'claude', enabled: false, path: dir, sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Claude' }, file, { db });
    const key = deriveSessionKey('claude', file), id = 'collected:' + key, collector = createNativeScopeCollector(db), project = await collector.collect({ taskIds: [id] });
    const before = await collectFoldingMetricRun(db, id, project);
    expect(spy).not.toHaveBeenCalled();
    expect(before.recorded).toMatchObject({ modelCalls: 2100, toolCalls: 2100 });
    expect(before.run.telemetry).toMatchObject({ complete: false, spans: [], usage: { input: 210000 } });
    expect(foldingRunMetrics(before)).toMatchObject({ input: 210000, tokens: 283500, modelCalls: 2100, toolCalls: 2100, modelSum: null, ttft: null });
    expect(before.limitations.join(' ')).toContain('4200');
    await writeFile(file, lines.join('\n') + '\n' + JSON.stringify({ type: 'irrelevant', text: 'x'.repeat(200000) }) + '\n');
    expect(await collectFoldingMetricRun(db, id, project)).toEqual(before);
    await expect(collectFoldingMetricRun(db, id, project, undefined, { byteLimit: 100 })).rejects.toMatchObject({ reason: 'TOO_LARGE', details: { limit: 100 } });
    db.prepare('UPDATE sessions SET event_count=25001 WHERE id=?').run(key);
    db.prepare("INSERT INTO proxy_requests (id,request_id,method,url,hostname,started_at) VALUES (1,'request','POST','/','local.test',?)").run(timestamp);
    db.prepare("INSERT INTO trace_associations (id,session_key,proxy_id,state,reason,created_at,updated_at) VALUES ('link',?,1,'confirmed','test',?,?)").run(key, timestamp, timestamp);
    const linked = await collectFoldingMetricRun(db, id, project);
    expect(spy).not.toHaveBeenCalled();
    expect(linked.limitations.join(' ')).toContain('25001');
  } finally { spy.mockRestore(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

it('preserves uniform Codex input conventions and normalizes mixed native/indexed usage before summing', async () => {
  const { codexScanner } = await import('../../local-sessions/codex.js');
  const dir = await mkdtemp(join(tmpdir(), 'folding-mixed-input-')), db = new Database(':memory:'); initSchema(db);
  try {
    const root = join(dir, 'root.jsonl'), child = join(dir, 'child.jsonl'), timestamp = '2026-10-30T00:00:00.000Z';
    const write = async (path: string, id: string, input: number, cacheRead: number, cacheWrite: number, isChild: boolean) => {
      await writeFile(path, [
        { type: 'session_meta', timestamp, payload: { id, ...(isChild ? { source: { subagent: { thread_spawn: { parent_thread_id: 'root' } } } } : {}) } },
        { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: 20, reasoning_output_tokens: 5, cached_input_tokens: cacheRead, cache_write_input_tokens: cacheWrite } } } },
      ].map(r => JSON.stringify(r)).join('\n') + '\n');
    };
    await write(root, 'root', 200, 50, 10, false); await write(child, 'child', 100, 25, 5, true);
    const config = { key: 'codex' as const, enabled: false, path: dir, sourceKind: 'jsonl' as const, watchStrategy: 'chokidar' as const, pollIntervalMs: 0, label: 'Codex' };
    await codexScanner.scanFile(config, root, { db }); await codexScanner.scanFile(config, child, { db });
    const id = 'collected:' + deriveSessionKey('codex', root), collector = createNativeScopeCollector(db), project = await collector.collect({ taskIds: [id] });
    const uniformNative = await collectFoldingMetricRun(db, id, project);
    expect(uniformNative.run.telemetry?.usage).toMatchObject({ input: 300, cacheRead: 75, cacheWrite: 15, inputIncludesCache: true });
    expect(foldingRunMetrics(uniformNative).tokens).toBe(340);
    expect(uniformNative.limitations.join(' ')).not.toContain('口径混合');
    db.prepare('UPDATE sessions SET detail_loaded=0 WHERE id=?').run(id.slice(10));
    const incompleteDetails = await collectFoldingMetricRun(db, id, project);
    expect(incompleteDetails.run.telemetry?.complete).toBe(false);
    expect(incompleteDetails.run.telemetry?.usage).toEqual(uniformNative.run.telemetry?.usage);
    expect(foldingRunMetrics(incompleteDetails).tokens).toBe(340);
    expect(incompleteDetails.limitations.join(' ')).toContain('明细不完整时仍显示原生用量');
    db.prepare('UPDATE sessions SET detail_loaded=1 WHERE id=?').run(id.slice(10));
    await rm(child);
    const mixed = await collectFoldingMetricRun(db, id, project);
    expect(mixed.run.telemetry?.usage).toMatchObject({ input: 210, cacheRead: 75, cacheWrite: 15, inputIncludesCache: false });
    expect(foldingRunMetrics(mixed)).toMatchObject({ input: 210, tokens: 340 });
    expect(mixed.limitations.join(' ')).toContain('口径混合');
    await rm(root);
    const uniformIndexed = await collectFoldingMetricRun(db, id, project);
    expect(uniformIndexed.run.telemetry?.usage).toMatchObject({ input: 210, inputIncludesCache: false });
    expect(uniformIndexed.limitations.join(' ')).not.toContain('口径混合');
    expect(foldingRunMetrics(uniformIndexed).tokens).toBe(340);
    // Missing cache evidence cannot turn an included input value into fresh input.
    await write(root, 'root', 200, 0, 10, false);
    const text = await import('node:fs/promises').then(fs => fs.readFile(root, 'utf8'));
    await writeFile(root, text.replace(',"cached_input_tokens":0', ''));
    const unknownCache = await collectFoldingMetricRun(db, id, project);
    expect(unknownCache.run.telemetry?.usage).toMatchObject({ input: null, inputIncludesCache: false });
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

it('charges each source once across scope, metrics and repeated group reads within one job', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folding-unique-files-')), db = new Database(':memory:'); initSchema(db);
  try {
    const file = join(dir, 'root.jsonl'), timestamp = '2026-10-30T00:00:00.000Z';
    await writeFile(file, JSON.stringify({ type: 'assistant', sessionId: 'root', timestamp, message: { id: 'msg', usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'text', text: 'TEST_ONLY' }] } }) + '\n');
    await claudeScanner.scanFile({ key: 'claude', enabled: false, path: dir, sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Claude' }, file, { db });
    const id = 'collected:' + deriveSessionKey('claude', file), size = (await stat(file)).size;
    const signal = new AbortController().signal, collector = createNativeScopeCollector(db, { byteLimit: size });
    const project = await collector.collect({ taskIds: [id] }, signal);
    const run = await collectFoldingMetricRun(db, id, project, signal);
    expect(run.run.telemetry?.usage.input).toBe(100);
    expect(sourceBudget(signal).bytes).toBe(size);
    // A fresh collector forces another scope read; no cache can hide double billing.
    const repeated = await createNativeScopeCollector(db).collect({ taskIds: [id] }, signal);
    expect(await collectFoldingMetricRun(db, id, repeated, signal)).toEqual(run);
    expect(sourceBudget(signal).bytes).toBe(size);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
