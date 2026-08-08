import { describe, expect, it } from 'vitest';

import type { TraceRecord } from './trace-types.js';
import { buildCompareReportHtml } from './compare-report.js';

function record(id: string): TraceRecord {
  return {
    session: {
      id, provider: 'codex', sourceAgent: 'Codex', title: `session ${id}`,
      startedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:01.000Z',
      status: 'success', cwd: null, messageCount: 0, eventCount: 0,
      tokenUsage: { input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2, netInput: 7, total: 40 },
      costUsd: 0.01, systemPrompt: null, dataSource: 'scan', sourcePath: `/tmp/${id}`,
      totalDurationMs: 1000, isSubagent: false,
    },
    events: [
      {
        id: `${id}-e1`, sessionId: id, sequence: 1, turnKey: null, kind: 'tool', phase: 'implement',
        title: 'fix', startedAt: '2026-08-01T00:00:00.000Z', durationMs: 100,
        status: 'success', actor: 'assistant', tool: 'Bash',
        tokens: { input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2, netInput: 7, total: 40 },
        error: null, hasInput: false, hasOutput: false, hasRaw: false,
        inputSummary: null, outputSummary: null,
      },
    ],
    tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
    turnKeySource: 'unavailable',
  };
}

describe('REQ-009 对比报告', () => {
  it('#18 包含左右两列、速度指标、token 分解与阶段时长分布', () => {
    const html = buildCompareReportHtml(record('left'), record('right'));
    expect(html).toContain('对比报告');
    expect(html).toContain('Left');
    expect(html).toContain('Right');
    expect(html).toContain('session left');
    expect(html).toContain('session right');
    expect(html).toContain('速度指标');
    expect(html).toContain('Token 分解');
    expect(html).toContain('阶段时长分布');
    expect(html).toContain('implement: 100 ms');
    expect(html).toContain('cacheWrite: 2');
  });

  it('§6.2 竞争力维度为三维（fast/frugal/quality），无独立 stability 维', () => {
    const html = buildCompareReportHtml(record('left'), record('right'));
    expect(html).toContain('fast: e2e');
    expect(html).toContain('frugal: total');
    expect(html).toContain('quality: readWriteRatio');
    expect(html).toContain('codeConciseness n/a (totalSteps / fileWriteCount)');
    // 三维要求：不再出现独立的 stability 维度行
    expect(html).not.toMatch(/stability:\s/);
  });

  it('en locale 输出英文报告', () => {
    const html = buildCompareReportHtml(record('left'), record('right'), 'en');
    expect(html).toContain('Comparison Report');
    expect(html).toContain('Speed metrics');
    expect(html).toContain('Token breakdown');
    expect(html).toContain('Phase duration distribution');
    expect(html).toContain('Median turn gap');
    expect(html).toContain('Competitive dimensions');
    expect(html).toContain('lang="en"');
  });
});
