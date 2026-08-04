import { describe, expect, it } from 'vitest';

import type { TraceEvent, TraceRecord } from './trace-types.js';
import { buildTraceReportHtml } from './report-html.js';

function makeRecord(eventCount: number): TraceRecord {
  const events: TraceEvent[] = Array.from({ length: eventCount }, (_, i) => ({
    id: `e${i}`,
    sessionId: 's1',
    sequence: i + 1,
    kind: 'llm',
    phase: 'implement',
    title: `event ${i} `.padEnd(80, 'x'),
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 10,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2 },
    error: null,
    hasInput: false,
    hasOutput: true,
    hasRaw: false,
    inputSummary: null,
    outputSummary: 'x'.repeat(100),
  }));
  return {
    session: {
      id: 's1', provider: 'codex', sourceAgent: 'Codex', title: 'report test',
      startedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:01.000Z',
      status: 'success', cwd: null, messageCount: 1, eventCount,
      tokenUsage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2 },
      costUsd: 0, systemPrompt: null, dataSource: 'scan', sourcePath: '/tmp/x',
      totalDurationMs: 1000, isSubagent: false,
    },
    events,
    tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
  };
}

describe('REQ-008 报告 HTML', () => {
  it('小 JSON 内联，不生成外部文件', () => {
    const result = buildTraceReportHtml(makeRecord(5));
    expect(result.externalDataFile).toBeNull();
    expect(result.html).toContain('<!doctype html>');
    expect(result.html).toContain('report test');
    expect(result.html).not.toContain('report-data.js');
  });

  it('大 JSON（>100KB）写入外部 .js，HTML 不内联数据', () => {
    const result = buildTraceReportHtml(makeRecord(3000));
    expect(result.externalDataFile).toBe('report-data.js');
    expect(result.html).toContain('src="report-data.js"');
    expect(result.html).not.toContain('window.__TRACE_DATA__ =');
    expect(result.externalDataJs).toContain('window.__TRACE_DATA__ =');
    expect(result.externalDataJs!.length).toBeGreaterThan(100 * 1024);
  });
});
