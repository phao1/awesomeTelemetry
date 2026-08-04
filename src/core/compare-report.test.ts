import { describe, expect, it } from 'vitest';

import type { TraceRecord } from './trace-types.js';
import { buildCompareReportHtml } from './compare-report.js';

function record(id: string): TraceRecord {
  return {
    session: {
      id, provider: 'codex', sourceAgent: 'Codex', title: `session ${id}`,
      startedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:01.000Z',
      status: 'success', cwd: null, messageCount: 0, eventCount: 0,
      tokenUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      costUsd: 0.01, systemPrompt: null, dataSource: 'scan', sourcePath: `/tmp/${id}`,
      totalDurationMs: 1000, isSubagent: false,
    },
    events: [],
    tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
  };
}

describe('REQ-009 对比报告', () => {
  it('包含左右两列与指标', () => {
    const html = buildCompareReportHtml(record('left'), record('right'));
    expect(html).toContain('对比报告');
    expect(html).toContain('Left');
    expect(html).toContain('Right');
    expect(html).toContain('session left');
    expect(html).toContain('session right');
    expect(html).toContain('errorRate');
  });
});
