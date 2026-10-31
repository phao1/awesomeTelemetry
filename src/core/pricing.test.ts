import { describe, expect, it } from 'vitest';

import {
  computeCost,
  formatCost,
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
    const r = computeCost(TOKENS, 'claude-opus-4-8');
    expect(r.cost).toBe(5); // input $5/1M
    expect(r.currency).toBe('USD');
    expect(r.costSource).toBe('estimated');
  });

  it('未知模型返回 { cost: 0, costSource: unknown } —— 不得渲染 $0.0000', () => {
    const r = computeCost(TOKENS, 'glm-4-plus');
    expect(r).toEqual({ cost: 0, costSource: 'unknown', currency: 'USD' });
    expect(computeCost(TOKENS, null)).toEqual({ cost: 0, costSource: 'unknown', currency: 'USD' });
    expect(computeCost(TOKENS, '')).toEqual({ cost: 0, costSource: 'unknown', currency: 'USD' });
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
    expect(computeCost(TOKENS, 'claude-opus-4-8').cost).toBe(1);
    expect(computeCost({ ...TOKENS, input: 1_000_000 }, 'my-model').cost).toBe(9);
    expect(computeCost(TOKENS, 'my-model').costSource).toBe('estimated');
    setModelPriceOverrides({});
  });
});

describe('2026-08-11 校准审计：reasoning 计费与币种', () => {
  const T = {
    input: 0, output: 49_812, reasoning: 12_211,
    cacheRead: 0, cacheWrite: 0, netInput: 0, total: 62_023,
  };

  it('reasoningBilledAsOutput 为真时把 reasoning 按输出价一起计', () => {
    setModelPriceOverrides({
      'r-model': { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0, contextWindow: 1000, source: 'test' },
    });
    // 不叠加：只算 output
    expect(computeCost(T, 'r-model').cost).toBe(49_812);
    // 叠加：output + reasoning，正是 DeepSeek 的账单口径
    expect(computeCost(T, 'r-model', { reasoningBilledAsOutput: true }).cost).toBe(62_023);
    setModelPriceOverrides({});
  });

  it('CNY 价格原样返回币种，不做汇率换算', () => {
    setModelPriceOverrides({
      // 单价来自网关计费流水：命中 ¥2.5e-8、未命中 ¥3e-6、输出 ¥6e-6 每 token
      'deepseek-v4-pro': {
        input: 3, output: 6, cacheRead: 0.025, cacheWrite: 0,
        contextWindow: 128_000, currency: 'CNY', source: 'test',
      },
    });
    const r = computeCost(
      { input: 275_108, output: 49_812, reasoning: 12_211, cacheRead: 5_918_848, cacheWrite: 0, netInput: 0, total: 0 },
      'deepseek-v4-pro',
      { reasoningBilledAsOutput: true },
    );
    expect(r.currency).toBe('CNY');
    // 2026-08-09 那次会话的账单是 ¥1.361969；这里喂的是本地扫描出来的 token 数，
    // 比账单少 1.2%（本地少记了 3 次请求，见校准报告 §01），所以对到 ¥1.3454 而不是
    // ¥1.3620 —— 差在计数不在算法。若照旧只算 output 不算 reasoning，会掉到 ¥1.2721。
    expect(r.cost).toBeCloseTo(1.3454, 3);
    expect(computeCost(
      { input: 275_108, output: 49_812, reasoning: 12_211, cacheRead: 5_918_848, cacheWrite: 0, netInput: 0, total: 0 },
      'deepseek-v4-pro',
    ).cost).toBeCloseTo(1.2721, 3);
    expect(formatCost(r.cost, r.costSource, r.currency, 4)).toBe('¥1.3454');
    setModelPriceOverrides({});
  });

  it('formatCost 未知来源仍渲染破折号，不显示 0', () => {
    expect(formatCost(0, 'unknown', 'CNY')).toBe('—');
    expect(formatCost(1.5, 'estimated', 'USD')).toBe('$1.5000');
  });
});
