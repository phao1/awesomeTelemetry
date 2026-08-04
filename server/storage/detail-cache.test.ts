import { describe, expect, it } from 'vitest';

import type { SessionDetailResponse } from '../../src/core/trace-types.js';
import { DetailCache } from './detail-cache.js';

function fakeDetail(key: string): SessionDetailResponse {
  return {
    session: {
      id: key,
      provider: 'codex',
      sourceAgent: 'Codex',
      title: '',
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      status: 'success',
      cwd: null,
      messageCount: 0,
      eventCount: 0,
      tokenUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      costUsd: 0,
      systemPrompt: null,
      dataSource: 'scan',
      sourcePath: '/tmp/x.jsonl',
      totalDurationMs: 0,
      isSubagent: false,
    },
    events: [],
    mode: 'slim',
    eventTotal: 0,
    eventOffset: 0,
    eventLimit: 0,
    hasMore: false,
    pending: false,
  };
}

describe('REQ-006 详情 LRU 缓存（容量 24）', () => {
  it('超过 24 条时淘汰最旧条目', () => {
    const cache = new DetailCache(24);
    for (let i = 1; i <= 25; i += 1) {
      cache.set(`k${i}`, fakeDetail(`k${i}`));
    }
    expect(cache.size).toBe(24);
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k25')).toBeDefined();
  });

  it('get 刷新最近使用，淘汰最久未用', () => {
    const cache = new DetailCache(3);
    cache.set('k1', fakeDetail('k1'));
    cache.set('k2', fakeDetail('k2'));
    cache.set('k3', fakeDetail('k3'));
    cache.get('k1');
    cache.set('k4', fakeDetail('k4'));

    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k1')).toBeDefined();
    expect(cache.get('k3')).toBeDefined();
    expect(cache.get('k4')).toBeDefined();
  });

  it('invalidate 与 clear', () => {
    const cache = new DetailCache();
    cache.set('k1', fakeDetail('k1'));
    cache.invalidate('k1');
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.size).toBe(0);

    cache.set('k1', fakeDetail('k1'));
    cache.set('k2', fakeDetail('k2'));
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
