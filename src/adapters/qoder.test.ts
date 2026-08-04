import { describe, expect, it } from 'vitest';

import { normalizeQoderSample, type QoderRawRow } from './qoder.js';
import { qoderFixture } from './__fixtures__/qoder.js';

const SRC = '/tmp/qoder.jsonl';

function sample(rows: QoderRawRow[]) {
  return { sourceAgent: 'Qoder', session: qoderFixture.session, events: rows };
}

describe('Qoder adapter（REQ-008）', () => {
  it('fixture 完整 TraceRecord 快照', () => {
    const r = normalizeQoderSample(sample(qoderFixture.events), SRC);
    expect(r.session.provider).toBe('qoder');
    expect(r.session.sourceAgent).toBe('Qoder');
    expect(r.session.id).toBe('qoder-s1');
    expect(r.session.eventCount).toBe(3);
    expect(r.events.map((e) => e.durationMs)).toEqual([2000, 3000, 0]); // 相邻时间戳，末条 0
    expect(r.events[1]?.phase).toBe('verify'); // bash npm test
    expect(r.session.tokenUsage).toEqual({
      input: 15, output: 10, reasoning: 1, cacheRead: 0, cacheWrite: 0, total: 26,
    });
  });

  it('cacheRead 用 sum（incremental）', () => {
    const rows: QoderRawRow[] = [
      { id: 'q1', type: 'llm', timestamp: '2026-08-01T00:00:00.000Z', tokens: { cache_read: 10 } },
      { id: 'q2', type: 'llm', timestamp: '2026-08-01T00:00:01.000Z', tokens: { cache_read: 5 } },
    ];
    const r = normalizeQoderSample(sample(rows), SRC);
    expect(r.session.tokenUsage.cacheRead).toBe(15);
  });

  it('状态归一化四类映射', () => {
    const rows: QoderRawRow[] = ['completed', 'failed', 'paused', 'canceled'].map((status, i) => ({
      id: `q${i}`, type: 'llm', timestamp: `2026-08-01T00:00:0${i}.000Z`, status,
    }));
    const r = normalizeQoderSample(sample(rows), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const rows: QoderRawRow[] = [
      { id: 'dup', type: 'llm', timestamp: '2026-08-01T00:00:00.000Z' },
      { id: 'dup', type: 'llm', timestamp: '2026-08-01T00:00:01.000Z' },
    ];
    const r = normalizeQoderSample(sample(rows), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['dup', 'dup:2']);
  });

  it('title 截断到 200 字符', () => {
    const rows: QoderRawRow[] = [{ id: 'q1', type: 'llm', timestamp: '2026-08-01T00:00:00.000Z', content: 'd'.repeat(250) }];
    const r = normalizeQoderSample(sample(rows), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeQoderSample(sample(qoderFixture.events), SRC);
    expect((r.events[0] as unknown as { raw?: string }).raw).toContain('"role"');
    expect(r.events[0]?.inputSummary).not.toContain('"role"');
  });
});
