import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { claudeScanner } from '../../local-sessions/claude.js';
import { deriveSessionKey } from '../../local-sessions/session-key.js';
import type { ProviderConfig } from '../../src/core/trace-types.js';
import { createNativeScopeCollector } from './native-scope.js';
import { analyzeFoldingProject } from '../../src/core/agent-folding-analysis.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'architecture-scope-'));
  const db = new Database(':memory:'); initSchema(db);
  cleanup.push(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const config: ProviderConfig = { key: 'claude', enabled: false, path: directory, sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Claude' };
  const roots: string[] = [];
  for (let n = 0; n < 2; n++) {
    const root = 'root-' + n;
    const file = join(directory, root + '.jsonl');
    const events: unknown[] = [];
    for (const [index, name] of ['researcher', 'reviewer'].entries()) {
      const child = root + '-' + name, id = child + '-call';
      events.push({ type: 'assistant', sessionId: root, cwd: '/project', timestamp: `2026-10-30T00:00:0${index}.000Z`, message: { id, content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: name } }] } });
      events.push({ type: 'user', sessionId: root, timestamp: `2026-10-30T00:00:0${index}.500Z`, toolUseResult: { agentId: child }, message: { content: [{ type: 'tool_result', tool_use_id: id, content: '[redacted]' }] } });
      const childPath = join(directory, child + '.jsonl');
      await writeFile(childPath, JSON.stringify({ type: 'user', sessionId: root, agentId: child, isSidechain: true, timestamp: '2026-10-30T00:00:00.000Z', message: { content: '[redacted]' } }) + '\n');
      await claudeScanner.scanFile(config, childPath, { db });
    }
    // A repeated retained block is not a second delegation.
    events.push(events[0]);
    await writeFile(file, events.map(v => JSON.stringify(v)).join('\n') + '\n');
    await claudeScanner.scanFile(config, file, { db });
    roots.push('collected:' + deriveSessionKey('claude', file));
  }
  return { db, roots, config, directory };
}

it('merges named definitions across roots and produces real coupling with native locators', async () => {
  const { db, roots } = await fixture();
  const collector = createNativeScopeCollector(db);
  const project = await collector.collect({ taskIds: roots });
  expect(project.agents.map(a => a.name).sort()).toEqual(['main', 'researcher', 'reviewer']);
  expect(project.traffic).toHaveLength(4);
  expect(project.agents.filter(a => !a.isMain).every(a => a.proposed === 'merge')).toBe(true);
  expect(project.boundaries.every(b => b.proposed === 'merge' && b.targetAgentIds.length === 2)).toBe(true);
  expect(new Set(project.traffic.map(t => t.traceId))).toEqual(new Set(roots));
  expect(project.evidence.every(e => e.native?.sessionKey && e.native.taskId && e.native.eventId)).toBe(true);
  expect(project.traffic.every(t => t.durationMs === null && t.inputTokens === null)).toBe(true);
  expect(analyzeFoldingProject(project).coupling).toEqual(expect.arrayContaining([expect.objectContaining({ traces: 2, coupling: 1, share: 1 })]));
  project.agents[0]!.name = 'mutated';
  expect((await collector.collect({ taskIds: [...roots].reverse() })).agents.some(a => a.name === 'mutated')).toBe(false);
  collector.close();
  await expect(collector.collect({})).rejects.toThrow('closed');
});

it('intersects filters, invalidates after database changes, and rejects bad selections or cancellation', async () => {
  const { db, roots } = await fixture();
  const collector = createNativeScopeCollector(db);
  expect((await collector.collect({ cwd: '/project', provider: 'claude' })).traffic).toHaveLength(4);
  const before = await collector.collect({ taskIds: [roots[0]!] });
  db.prepare('UPDATE sessions SET cwd=? WHERE id=?').run('/other', roots[0]!.slice(10));
  const after = await collector.collect({ taskIds: [roots[0]!] });
  expect(after.sources[0]!.revision).not.toBe(before.sources[0]!.revision);
  expect((await collector.collect({ cwd: '/project' })).traffic).toHaveLength(2);
  await expect(collector.collect({ taskIds: [roots[0]!, roots[0]!] })).rejects.toThrow();
  await expect(collector.collect({ from: 'bad' })).rejects.toThrow();
  await expect(collector.collect({ cwd: '/missing' })).rejects.toThrow('No tasks');
  await expect(collector.collect({}, AbortSignal.abort())).rejects.toThrow();
});

it('reads Codex spawn results and definition roles without guessing from names', async () => {
  const { db, directory, config } = await fixture();
  const { codexScanner } = await import('../../local-sessions/codex.js');
  const parent = join(directory, 'codex-root.jsonl'), child = join(directory, 'codex-child.jsonl');
  const timestamp = '2026-10-30T00:00:00.000Z';
  await writeFile(parent, [
    { type: 'session_meta', timestamp, payload: { id: 'codex-root', cwd: '/project' } },
    { type: 'response_item', timestamp, payload: { type: 'function_call', name: 'spawn_agent', call_id: 'spawn-1', arguments: '{}' } },
    { type: 'response_item', timestamp, payload: { type: 'function_call_output', call_id: 'spawn-1', output: JSON.stringify({ agent_id: 'codex-child' }) } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(child, JSON.stringify({ type: 'session_meta', timestamp, payload: { id: 'codex-child', source: { subagent: { thread_spawn: { parent_thread_id: 'codex-root', agent_role: 'reviewer' } } } } }) + '\n');
  await codexScanner.scanFile({ ...config, key: 'codex' }, parent, { db });
  await codexScanner.scanFile({ ...config, key: 'codex' }, child, { db });
  const collector = createNativeScopeCollector(db);
  await expect(collector.collect({})).rejects.toThrow('one provider');
  const p = await collector.collect({ provider: 'codex' });
  expect(p.traffic).toHaveLength(1);
  expect(p.agents.find(a => a.id === p.traffic[0]!.agentId)?.name).toBe('reviewer');
  expect(p.evidence[0]?.complete).toBe(true);
  expect(p.evidence[0]?.native?.eventId).toBe('spawn-1');
});
