import { describe, expect, it } from 'vitest';

import {
  compareSideStats,
  diffPct,
  errorDistribution,
  eventKindCounts,
  phaseDurations,
} from './compare-stats.js';
import { makeEvent, makeSession, makeSpeed } from './compare-test-fixtures.js';

describe('compare-stats', () => {
  it('diffPct 相等为 0，倍率按较小值为基', () => {
    expect(diffPct(10, 10)).toBe(0);
    expect(diffPct(20, 10)).toBe(100);
    expect(diffPct(0, 0)).toBe(0);
  });

  it('compareSideStats 汇总工具/写入/测试/修复循环', () => {
    const events = [
      makeEvent({ id: 'a', tool: 'Bash', durationMs: 50 }),
      makeEvent({ id: 'b', kind: 'file_write', phase: 'implement', durationMs: 20 }),
      makeEvent({ id: 'c', kind: 'file_read', phase: 'understand', durationMs: 10 }),
      makeEvent({ id: 'd', phase: 'verify', title: 'npm test', durationMs: 30 }),
      makeEvent({ id: 'e', kind: 'user_prompt', phase: 'plan', actor: 'user', durationMs: 0 }),
      makeEvent({ id: 'f', kind: 'tool', tool: 'Bash', status: 'error', error: 'ENOENT', durationMs: 5 }),
    ];
    const stats = compareSideStats(events, makeSpeed(), makeSession('s'));
    expect(stats.totalToolDuration).toBe(55);
    expect(stats.fileWrites).toBe(1);
    expect(stats.fileReads).toBe(1);
    expect(stats.hasUnitTests).toBe(true);
    expect(stats.userRounds).toBe(1);
    expect(stats.failedCommands).toBe(1);
    expect(stats.codeConciseness).toBe(5);
  });

  it('phaseDurations 按阶段累计且缺失阶段为 0', () => {
    const out = phaseDurations([
      makeEvent({ id: 'a', phase: 'implement', durationMs: 10 }),
      makeEvent({ id: 'b', phase: 'implement', durationMs: 20 }),
      makeEvent({ id: 'c', phase: 'verify', durationMs: 30 }),
    ]);
    expect(out.implement).toBe(30);
    expect(out.verify).toBe(30);
    expect(out.understand).toBe(0);
  });

  it('eventKindCounts 计数', () => {
    const map = eventKindCounts([
      makeEvent({ id: 'a', kind: 'tool' }),
      makeEvent({ id: 'b', kind: 'tool' }),
      makeEvent({ id: 'c', kind: 'llm' }),
    ]);
    expect(map.get('tool')).toBe(2);
    expect(map.get('llm')).toBe(1);
  });

  it('errorDistribution 按工具分组、按总错误数降序', () => {
    const left = [
      makeEvent({ id: 'a', tool: 'Bash', status: 'error' }),
      makeEvent({ id: 'b', tool: 'Bash', status: 'error' }),
      makeEvent({ id: 'c', tool: 'Read', status: 'error' }),
    ];
    const right = [makeEvent({ id: 'd', tool: 'Bash', status: 'error' })];
    const buckets = errorDistribution(left, right);
    expect(buckets[0]?.tool).toBe('Bash');
    expect(buckets[0]?.lf).toBe(2);
    expect(buckets[0]?.rf).toBe(1);
    expect(buckets[1]?.tool).toBe('Read');
  });
});
