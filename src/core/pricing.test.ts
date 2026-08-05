import { describe, expect, it } from 'vitest';

import {
  computeCostUsd,
  lookupContextWindow,
  lookupModelPrice,
  normalizeModelId,
  setModelPriceOverrides,
} from './pricing.js';

const TOKENS = { input: 1_000_000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 1_000_000, total: 1_000_000 };

describe('pricing（add-mission-control §1 P0-C / REQ-013）', () => {
  it('归一化：去厂商前缀 / 日期后缀 / 窗口标注', () => {
    expect(normalizeModelId('anthropic.claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(normalizeModelId('claude-opus-4-8-20251101')).toBe('claude-opus-4-8');
    expect(normalizeModelId('claude-opus-4-8[1m]')).toBe('claude-opus-4-8');
  });

  it('已知模型按定价表估算并标 estimated；价格条目带 source', () => {
    const price = lookupModelPrice('claude-opus-4-8');
    expect(price).not.toBeNull();
    expect(price!.source.length).toBeGreaterThan(0);
    const r = computeCostUsd(TOKENS, 'claude-opus-4-8');
    expect(r.costUsd).toBe(5); // input $5/1M
    expect(r.costSource).toBe('estimated');
  });

  it('未知模型返回 { costUsd: 0, costSource: unknown } —— 不得渲染 $0.0000', () => {
    const r = computeCostUsd(TOKENS, 'glm-4-plus');
    expect(r).toEqual({ costUsd: 0, costSource: 'unknown' });
    expect(computeCostUsd(TOKENS, null)).toEqual({ costUsd: 0, costSource: 'unknown' });
    expect(computeCostUsd(TOKENS, '')).toEqual({ costUsd: 0, costSource: 'unknown' });
  });

  it('lookupContextWindow：已知模型返回定价表窗口，未知返回 null（禁止硬编码 200k）', () => {
    expect(lookupContextWindow('claude-haiku-4-5')).toBe(200_000);
    expect(lookupContextWindow('deepseek-v3')).toBeNull();
    expect(lookupContextWindow(null)).toBeNull();
  });

  it('setModelPriceOverrides：同 key 覆盖内置，新 key 扩展（G2.3 覆盖层）', () => {
    setModelPriceOverrides({
      'claude-opus-4-8': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, contextWindow: 1000, source: 'test override' },
      'my-model': { input: 9, output: 9, cacheRead: 0, cacheWrite: 0, contextWindow: 64_000, source: 'test new' },
    });
    expect(computeCostUsd(TOKENS, 'claude-opus-4-8').costUsd).toBe(1);
    expect(computeCostUsd({ ...TOKENS, input: 1_000_000 }, 'my-model').costUsd).toBe(9);
    expect(computeCostUsd(TOKENS, 'my-model').costSource).toBe('estimated');
    setModelPriceOverrides({});
  });
});
