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
  it('exports Token components but no monetary summary in either locale and preserves input records',()=>{
    const left=record('left');left.session.costUsd=456789.1234;
    for(const locale of ['zh','en'] as const){const html=buildCompareReportHtml(left,record('right'),locale);expect(html).not.toContain('456789.1234');expect(html).not.toMatch(/\bcost\s+[\d$]/);expect(html).toContain('cacheWrite: 2');expect(html).toContain('total: 40');}
    expect(left.session.costUsd).toBe(456789.1234);
  });
  it('labels legacy scan formulas and derived session declaration without claiming measured tools', () => {
    const left = record('derived'); left.session.durationSource = 'derived';
    const html = buildCompareReportHtml(left, record('unknown'), 'en');
    expect(html).toContain('Legacy scan timing');
    expect(html).toContain('TTFT: first user_prompt to first LLM log start');
    expect(html).toContain('TPS: arithmetic mean of valid per-LLM output/duration');
    expect(html).toContain('TPOT: sum valid LLM durations / sum output');
    expect(html).toContain('includes scheduling gaps');
    expect(html).toContain('Session duration declaration: unknown');
    expect(html).toContain('not per-event measurement proof');
    expect(html).toContain('not a causal performance improvement');
  });

  it('renders Chinese criteria and untrusted session declarations inertly', () => {
    const left = record('measured'); left.session.durationSource = 'measured';
    const html = buildCompareReportHtml(left, record('unknown'));
    expect(html).toContain('旧扫描指标口径');
    expect(html).toContain('不是网络首 token');
    expect(html).toContain('会话时长来源声明：measured');
    expect(html).toContain('逐事件实测依据仍未知');
  });

  it('does not export an invalid E2E measurement as a real time', () => {
    const left = record('invalid'); left.session.totalDurationMs = NaN;
    const html = buildCompareReportHtml(left, record('right'), 'en');
    expect(html).not.toContain('NaN');
    expect(html).toContain('e2e: n/a');
  });
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
