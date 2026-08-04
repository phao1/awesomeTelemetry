import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { TraceEvent, TraceRecord } from '../../src/core/trace-types.js';
import { computeMetrics } from '../../src/core/metrics.js';
import { getAgentOverview } from './overview.js';
import { initSchema } from './schema.js';
import { upsertEvents, upsertSessionFromTrace } from './writers.js';

function makeRecord(id: string, over: {
  phases?: string[];
  eventStatuses?: Array<'success' | 'error'>;
  toolDurations?: number[];
} = {}): TraceRecord {
  const phases = over.phases ?? ['implement'];
  const statuses = over.eventStatuses ?? ['success'];
  const events: TraceEvent[] = phases.map((phase, i) => ({
    id: `${id}-e${i}`,
    sessionId: id,
    sequence: i + 1,
    kind: (phase === 'verify' ? 'test' : 'tool') as TraceEvent['kind'],
    phase: phase as TraceEvent['phase'],
    title: `ev ${i}`,
    startedAt: `2026-08-01T00:00:0${i}.000Z`,
    durationMs: over.toolDurations?.[i] ?? 100,
    status: (statuses[i] ?? 'success') as TraceEvent['status'],
    actor: 'assistant',
    tool: 'Bash',
    tokens: { input: 10, output: 5, reasoning: 1, cacheRead: 0, cacheWrite: 0, total: 16 },
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    inputSummary: null,
    outputSummary: null,
  }));
  return {
    session: {
      id,
      provider: 'codex',
      sourceAgent: 'Codex',
      title: `s ${id}`,
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:10.000Z',
      status: 'success',
      cwd: null,
      messageCount: 1,
      eventCount: events.length,
      tokenUsage: { input: 10 * events.length, output: 5 * events.length, reasoning: events.length, cacheRead: 0, cacheWrite: 0, total: 16 * events.length },
      costUsd: 0.01,
      systemPrompt: null,
      dataSource: 'scan',
      sourcePath: `/tmp/${id}.jsonl`,
      totalDurationMs: 10_000,
      isSubagent: false,
    },
    events,
    tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
  };
}

describe('REQ-011 口径一致性（SQL 聚合 vs computeMetrics 平均）', () => {
  it('errorRate / verificationCoverage / avgToolDurationMs 差值 < 0.001', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const records = [
      makeRecord('a', { phases: ['implement', 'verify'], eventStatuses: ['success', 'success'], toolDurations: [100, 60] }),
      makeRecord('b', { phases: ['implement', 'implement'], eventStatuses: ['error', 'success'], toolDurations: [300] }),
      makeRecord('c', { phases: ['implement', 'debug'], eventStatuses: ['success', 'error'], toolDurations: [50, 50] }),
      makeRecord('d', { phases: ['implement'], eventStatuses: ['success'], toolDurations: [0] }),
    ];
    for (const record of records) {
      upsertSessionFromTrace(db, record.session);
      upsertEvents(db, record.session.id, record.events);
    }

    const overview = getAgentOverview(db, 'scan');
    const row = overview.rows.find((r) => r.provider === 'codex');
    expect(row).toBeDefined();
    const avg = (fn: (r: TraceRecord) => number) =>
      records.reduce((sum, r) => sum + fn(r), 0) / records.length;

    expect(Math.abs(row!.errorRate! - avg((r) => computeMetrics(r).errorRate))).toBeLessThan(0.001);
    expect(Math.abs(row!.verificationCoverage! - avg((r) => computeMetrics(r).verificationCoverage))).toBeLessThan(0.001);
    expect(Math.abs(row!.avgToolDurationMs! - avg((r) => computeMetrics(r).avgToolDurationMs))).toBeLessThan(0.001);
    db.close();
  });
});
