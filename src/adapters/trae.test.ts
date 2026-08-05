import { describe, expect, it } from 'vitest';

import { normalizeTraeSample, type TraeTurn } from './trae.js';
import { traeFixture } from './__fixtures__/trae.js';

const SRC = '/tmp/trae.db';

function sample(turns: TraeTurn[]) {
  return { sourceAgent: 'Trae', session: traeFixture.session, events: turns };
}

describe('Trae adapter（REQ-006）', () => {
  it('fixture 完整 TraceRecord 快照', () => {
    const r = normalizeTraeSample(sample(traeFixture.events), SRC);
    expect(r.session.provider).toBe('trae');
    expect(r.session.sourceAgent).toBe('Trae');
    expect(r.session.id).toBe('trae-s1');
    expect(r.session.eventCount).toBe(4);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'success', 'success', 'running']);
    expect(r.events.map((e) => e.phase)).toEqual(['understand', 'understand', 'implement', 'verify']);
    // #2/#3：token_usage 200 是真实总 token，item_token_usage 120 是 output，
    // input = 200 - 120 = 80（不再 /2）
    expect(r.events[2]?.tokens?.output).toBe(120);
    expect(r.events[2]?.tokens?.input).toBe(80);
    expect(r.session.tokenUsage.output).toBe(120);
    expect(r.session.tokenUsage.input).toBe(80);
    expect(r.session.tokenUsage.total).toBe(200);
    expect(r.events[2]?.startedAt).toBe(new Date(1754000030 * 1000).toISOString());
  });

  it('#2/#3 itemTokenUsage 缺失时退化为 output = tokenUsage（不再 /2）', () => {
    const turns: TraeTurn[] = [
      { id: 't1', type: 'llm', contentSource: 'llm_default', tokenUsage: 200, startTime: 1754000000 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events[0]?.tokens?.output).toBe(200);
    expect(r.events[0]?.tokens?.input).toBe(0);
    expect(r.session.tokenUsage.total).toBe(200);
  });

  it('非 llm_default 行的 token_usage 是 message size，跳过', () => {
    const turns: TraeTurn[] = [
      { id: 't1', type: 'bash', contentSource: 'tool', tokenUsage: 999, startTime: 1754000000 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events[0]?.tokens).toBeNull();
    expect(r.session.tokenUsage.output).toBe(0);
  });

  it('状态归一化四类映射', () => {
    const turns: TraeTurn[] = ['completed', 'failed', 'paused', 'canceled'].map((status, i) => ({
      id: `t${i}`, type: 'llm', status, startTime: 1754000000 + i,
    }));
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const turns: TraeTurn[] = [
      { id: 'dup', type: 'llm', startTime: 1754000000 },
      { id: 'dup', type: 'llm', startTime: 1754000001 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['dup', 'dup:2']);
  });

  it('title 截断到 200 字符', () => {
    const turns: TraeTurn[] = [{ id: 't1', type: 'llm', content: 'c'.repeat(250), startTime: 1754000000 }];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeTraeSample(sample(traeFixture.events), SRC);
    expect((r.events[0] as unknown as { raw?: string }).raw).toContain('"type"');
    expect(r.events[0]?.title).not.toContain('"type"');
  });
});
