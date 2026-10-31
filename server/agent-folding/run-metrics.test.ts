import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
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
    collector.close();
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

it('uses the final Codex cumulative usage snapshot, not the sum of cumulative snapshots', async () => {
  const { codexScanner } = await import('../../local-sessions/codex.js');
  const dir = await mkdtemp(join(tmpdir(), 'folding-codex-metrics-')), db = new Database(':memory:'); initSchema(db);
  try {
    const file = join(dir, 'codex.jsonl'), timestamp = '2026-10-30T00:00:00.000Z';
    const usage = (input: number) => ({ input_tokens: input, output_tokens: 20, reasoning_output_tokens: 5, cached_input_tokens: 50, cache_write_input_tokens: 0 });
    await writeFile(file, [
      { type: 'session_meta', timestamp, payload: { id: 'codex-root', cwd: '/test' } },
      { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'TEST_ONLY' }] } },
      { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: usage(100) } } },
      { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'TEST_ONLY' }] } },
      { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: usage(200) } } },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    await codexScanner.scanFile({ key: 'codex', enabled: false, path: dir, sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Codex' }, file, { db });
    const id = 'collected:' + deriveSessionKey('codex', file), collector = createNativeScopeCollector(db), p = await collector.collect({ taskIds: [id] });
    const run = await collectFoldingMetricRun(db, id, p);
    expect(foldingRunMetrics(run)).toMatchObject({ input: 200, output: 20, reasoning: 5, tokens: 220, cacheRead: 50, modelCalls: null, ttft: null });
    collector.close();
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
