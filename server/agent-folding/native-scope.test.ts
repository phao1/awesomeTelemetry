import { mkdtemp, writeFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
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

it('falls back to indexed native identities for removed children and invalidates missing-file cache when restored', async () => {
  const { db, roots, directory } = await fixture();
  const collector = createNativeScopeCollector(db), child = join(directory, 'root-0-reviewer.jsonl');
  await rm(child);
  const p = await collector.collect({ taskIds: [roots[0]!] });
  expect(p.traffic).toHaveLength(2);
  expect(p.evidence.every(e => e.complete)).toBe(true);
  expect(p.limitations.join(' ')).toContain('1 个成员');
  await writeFile(child, JSON.stringify({ isSidechain: true, agentId: 'root-0-reviewer' }) + '\n');
  const restored = await collector.collect({ taskIds: [roots[0]!] });
  expect(restored.sources[0]!.revision).not.toBe(p.sources[0]!.revision);
  expect(restored.limitations.join(' ')).not.toContain('indexed source fallback');
  await rm(join(directory, 'root-0.jsonl'));
  const missingRoot = await collector.collect({ taskIds: [roots[0]!] });
  expect(missingRoot.traffic).toHaveLength(2);
  expect(missingRoot.evidence.every(e => !e.complete)).toBe(true);
  expect(missingRoot.boundaries).toHaveLength(0);
  expect(missingRoot.agents).toHaveLength(3);
  expect(missingRoot.limitations.join(' ')).toContain('Unresolved delegation');
});

it('enforces an injectable byte budget, skips irrelevant large lines without changing projection and detects revision changes', async () => {
  const { db, roots, directory } = await fixture();
  const scope = { taskIds: [roots[0]!] };
  await expect(createNativeScopeCollector(db, { byteLimit: 32 }).collect(scope)).rejects.toMatchObject({ reason: 'TOO_LARGE', details: { limit: 32 } });
  const before = await createNativeScopeCollector(db).collect(scope);
  await appendFile(join(directory, 'root-0.jsonl'), JSON.stringify({ type: 'unrelated', text: 'x'.repeat(200000) }) + '\n');
  const after = await createNativeScopeCollector(db).collect(scope);
  expect(after.traffic).toEqual(before.traffic);
  expect(after.agents).toEqual(before.agents);
  expect(after.evidence).toEqual(before.evidence);
  const reading = createNativeScopeCollector(db).collect(scope);
  db.prepare('UPDATE sessions SET title=?').run('changed');
  await expect(reading).rejects.toMatchObject({ reason: 'SOURCE_CHANGED' });
});

it('retains unindexed delegations as unresolved evidence with null locators', async () => {
  const { db, roots } = await fixture();
  db.prepare("DELETE FROM trace_identities WHERE kind='tool_call'").run();
  const project = await createNativeScopeCollector(db).collect({ taskIds: [roots[0]!] });
  expect(project.traffic).toHaveLength(2);
  expect(project.evidence.every(e => e.native?.eventId === null && !e.complete)).toBe(true);
  expect(project.boundaries).toHaveLength(0);
  expect(project.limitations.join(' ')).toContain('2 次委派尚未建立索引');
  expect(project.limitations.join(' ')).toContain('执行轨迹加载详情后重试');
});

it('loads readable root and child details before the revision snapshot and refreshes context', async () => {
  const { db, roots, config, directory } = await fixture();
  const key = roots[0]!.slice(10), childPath = join(directory, 'root-0-reviewer.jsonl'), childKey = deriveSessionKey('claude', childPath);
  db.prepare('UPDATE sessions SET detail_loaded=0 WHERE id IN (?,?)').run(key, childKey);
  // A header-only root has no identity manifest yet; restoring it also reveals children.
  db.prepare('DELETE FROM trace_identity_sources WHERE session_key=?').run(key);
  const signal = new AbortController().signal;
  const ensureDetail = vi.fn(async (sessionKey: string, current?: AbortSignal) => {
    expect(current).toBe(signal);
    const row = db.prepare('SELECT source_path FROM sessions WHERE id=?').get(sessionKey) as { source_path: string };
    await claudeScanner.scanFile(config, row.source_path, { db, force: true });
  });
  const project = await createNativeScopeCollector(db, { ensureDetail }).collect({ taskIds: [roots[0]!] }, signal);
  expect(ensureDetail.mock.calls.map(c => c[0]).sort()).toEqual([key, childKey].sort());
  expect(project.traffic).toHaveLength(2);
  expect(project.evidence.every(e => e.complete && e.native?.eventId)).toBe(true);
  expect(project.limitations.join(' ')).not.toContain('Scope includes unindexed members');
  expect(project.limitations.join(' ')).not.toContain('尚未建立索引');
});

it.each(['failed', 'unchanged', 'missing'] as const)('degrades when lazy details are %s and never requests missing source files', async mode => {
  const { db, roots, directory } = await fixture();
  const key = roots[0]!.slice(10);
  db.prepare('UPDATE sessions SET detail_loaded=0 WHERE id=?').run(key);
  if (mode !== 'missing') db.prepare("DELETE FROM trace_identities WHERE kind='tool_call'").run();
  if (mode === 'missing') await rm(join(directory, 'root-0.jsonl'));
  const ensureDetail = vi.fn(async () => { if (mode === 'failed') throw new Error('PRIVATE_FAILURE'); });
  const project = await createNativeScopeCollector(db, { ensureDetail }).collect({ taskIds: [roots[0]!] });
  expect(ensureDetail).toHaveBeenCalledTimes(mode === 'missing' ? 0 : 1);
  expect(project.traffic).toHaveLength(2);
  expect(project.evidence.every(e => !e.complete)).toBe(true);
  if (mode !== 'missing') {
    expect(project.evidence.every(e => e.native?.eventId === null)).toBe(true);
    expect(project.limitations.join(' ')).toContain('2 次委派尚未建立索引');
  } else expect(project.limitations.join(' ')).toContain('indexed source fallback');
  if (mode === 'failed') expect(project.limitations.join(' ')).toContain('详情加载失败');
  expect(JSON.stringify(project)).not.toContain('PRIVATE_FAILURE');
});

it('honors cancellation while waiting for a detail loader that ignores the signal', async () => {
  const { db, roots } = await fixture();
  db.prepare('UPDATE sessions SET detail_loaded=0 WHERE id=?').run(roots[0]!.slice(10));
  const controller = new AbortController(); let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const collector = createNativeScopeCollector(db, { ensureDetail: async () => { started(); return new Promise(() => {}); } });
  const pending = collector.collect({ taskIds: [roots[0]!] }, controller.signal);
  await ready; controller.abort();
  await expect(pending).rejects.toThrow();
});
