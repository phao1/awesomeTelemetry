import type { CostSource, TokenUsage } from './trace-types.js';

/**
 * add-mission-control §1 P0-C：模型定价与上下文窗口。
 *
 * ⚠️ **本文件的价格严禁凭记忆填写。** 每条必须带 `source`（出处 + 抓取日期）。
 * 查不到价格的模型**不要写进表里** —— 让它走 costSource='unknown' 显示 `—`，
 * 比编一个错价格好：错价格会让 B 区所有成本数字系统性偏差且极难发现。
 *
 * 用户可通过 config/model-pricing.json 覆盖/扩展（三层覆盖，同 G2.3）。
 */
export interface ModelPrice {
  /** USD / 1M tokens */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 上下文窗口 token 数，B12 上下文压力用（禁止硬编码 200k）。 */
  contextWindow: number;
  /** 价格出处：URL 或文档名 + 抓取日期。必填。 */
  source: string;
}

const ANTHROPIC_SRC = 'anthropic claude-api skill, models table cached 2026-06-24';

/**
 * 缓存价率（同上出处）：读 ≈ 输入价 ×0.1；写（5 分钟 TTL，默认）= 输入价 ×1.25。
 * 1 小时 TTL 是 ×2，本项目无法从会话文件区分 TTL，统一按默认 5 分钟计。
 */
const CACHE_READ_RATIO = 0.1;
const CACHE_WRITE_RATIO = 1.25;

function anthropic(input: number, output: number, contextWindow: number): ModelPrice {
  return {
    input,
    output,
    cacheRead: input * CACHE_READ_RATIO,
    cacheWrite: input * CACHE_WRITE_RATIO,
    contextWindow,
    source: ANTHROPIC_SRC,
  };
}

/**
 * 内置默认表。**只收录有权威出处的模型。**
 * 其他厂商（glm / deepseek / qwen / doubao 等）本次没有权威当前价格，
 * 故意留空 → 走 unknown 显示 `—`，由用户在 config/model-pricing.json 补充。
 */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5': anthropic(10, 50, 1_000_000),
  'claude-mythos-5': anthropic(10, 50, 1_000_000),
  'claude-opus-5': anthropic(5, 25, 1_000_000),
  'claude-opus-4-8': anthropic(5, 25, 1_000_000),
  'claude-opus-4-7': anthropic(5, 25, 1_000_000),
  'claude-opus-4-6': anthropic(5, 25, 1_000_000),
  'claude-sonnet-5': anthropic(3, 15, 1_000_000),
  'claude-sonnet-4-6': anthropic(3, 15, 1_000_000),
  'claude-haiku-4-5': anthropic(1, 5, 200_000),
};

let overrides: Record<string, ModelPrice> = {};

/** 加载用户定价覆盖层（config/model-pricing.json）。同 key 覆盖内置。 */
export function setModelPriceOverrides(table: Record<string, ModelPrice>): void {
  overrides = table;
}

/**
 * 归一化模型标识：去掉日期后缀与厂商前缀，让
 * `anthropic.claude-opus-4-8` / `claude-opus-4-8-20251101` 都能命中同一条。
 */
export function normalizeModelId(model: string): string {
  const lowered = model.trim().toLowerCase();
  const noVendor = lowered.replace(/^(anthropic|us|eu|apac)\./, '');
  // 去掉 [1m] 之类的窗口标注和 8 位日期后缀
  return noVendor.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '').trim();
}

export function lookupModelPrice(model: string | null | undefined): ModelPrice | null {
  if (model === null || model === undefined || model === '') {
    return null;
  }
  const key = normalizeModelId(model);
  return overrides[key] ?? DEFAULT_MODEL_PRICES[key] ?? null;
}

/** B12：上下文窗口大小。未知模型返回 null —— **禁止回落到硬编码 200k**。 */
export function lookupContextWindow(model: string | null | undefined): number | null {
  return lookupModelPrice(model)?.contextWindow ?? null;
}

/**
 * 按 token 明细与模型估算成本。
 * 未知模型返回 { costUsd: 0, costSource: 'unknown' } —— 调用方**必须**据
 * costSource 渲染 `—` 而不是 $0.0000（specs/frontend REQ-017/018）。
 */
export function computeCostUsd(
  tokens: TokenUsage,
  model: string | null | undefined,
): { costUsd: number; costSource: CostSource } {
  const price = lookupModelPrice(model);
  if (price === null) {
    return { costUsd: 0, costSource: 'unknown' };
  }
  const perMillion =
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheRead * price.cacheRead +
    tokens.cacheWrite * price.cacheWrite;
  return { costUsd: perMillion / 1_000_000, costSource: 'estimated' };
}
