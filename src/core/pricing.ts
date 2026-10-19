import type { CostSource, PriceCurrency, TokenUsage } from './trace-types.js';

export type { PriceCurrency };

/**
 * add-mission-control §1 P0-C：模型定价与上下文窗口。
 *
 * ⚠️ **本文件的价格严禁凭记忆填写。** 每条必须带 `source`（出处 + 抓取日期）。
 * 查不到价格的模型**不要写进表里** —— 让它走 costSource='unknown' 显示 `—`，
 * 比编一个错价格好：错价格会让 B 区所有成本数字系统性偏差且极难发现。
 *
 * 用户可通过 config/model-pricing.json 覆盖/扩展（三层覆盖，同 G2.3）。
 * // TODO(D-010): 定价表数据来源与更新责任人待人工确认 —— 内置表仅收录
 * claude-api skill（cached 2026-06-24）的 Anthropic 模型，其他厂商留空走
 * costSource='unknown' 显示 —。
 */
/**
 * 计价币种。
 *
 * 加这个字段是因为「只支持 USD」会逼人造汇率：国内网关（DeepSeek / 智谱 / 通义…）
 * 的账单是 CNY/token，要录进只认 USD 的表就得自己折一个汇率进去，而汇率既没有
 * 出处、又天天变 —— 正好违反本文件顶部「没有出处的价格不要写」那条规矩。
 * 于是让价格带上自己的币种，原样录入、原样展示，不做任何换算。
 * 类型定义在 trace-types.ts（数据模型的权威来源），这里只做转出。
 */
export const CURRENCY_SYMBOL: Record<PriceCurrency, string> = {
  USD: '$',
  CNY: '¥',
};

export interface ModelPrice {
  /** 价格 / 1M tokens，单位是 `currency` 声明的币种。 */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 上下文窗口 token 数，B12 上下文压力用（禁止硬编码 200k）。 */
  contextWindow: number;
  /** 价格出处：URL 或文档名 + 抓取日期。必填。 */
  source: string;
  /** 缺省 USD（内置表全是 USD，老的覆盖层文件不写这个字段也照常工作）。 */
  currency?: PriceCurrency;
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

export interface CostOptions {
  /**
   * reasoning 是不是**独立于 output 之外**、另算一份钱的量。
   *
   * 取值与 adapter 的 `tokenSemantics.reasoningInTotal` 同源：
   * - `true`（CodeArts / DeepSeek 系）：`output` 字段里**不含** reasoning，
   *   而账单把两者合起来按输出价计费 —— 必须叠加，否则少算。
   * - `false`（Codex 系，reasoning ⊂ output）：叠加就成了双计。
   *
   * 2026-08-09 实测：CodeArts 一次会话 output 49,812 + reasoning 12,211 = 62,023，
   * 网关账单 64,789 量级；只按 output 计价会漏掉 23% 的输出费用。
   * 缺省 false —— 不传就维持老行为，不会让既有调用方悄悄涨价。
   */
  reasoningBilledAsOutput?: boolean;
}

export interface CostResult {
  /** 金额，单位见 `currency`。 */
  cost: number;
  costSource: CostSource;
  currency: PriceCurrency;
}

/**
 * 按 token 明细与模型估算成本。
 * 未知模型返回 { cost: 0, costSource: 'unknown' } —— 调用方**必须**据
 * costSource 渲染 `—` 而不是 $0.0000（specs/frontend REQ-017/018）。
 */
export function computeCost(
  tokens: TokenUsage,
  model: string | null | undefined,
  options: CostOptions = {},
): CostResult {
  const price = lookupModelPrice(model);
  if (price === null) {
    return { cost: 0, costSource: 'unknown', currency: 'USD' };
  }
  const billedOutput =
    tokens.output + (options.reasoningBilledAsOutput === true ? tokens.reasoning : 0);
  const perMillion =
    tokens.input * price.input +
    billedOutput * price.output +
    tokens.cacheRead * price.cacheRead +
    tokens.cacheWrite * price.cacheWrite;
  return {
    cost: perMillion / 1_000_000,
    costSource: 'estimated',
    currency: price.currency ?? 'USD',
  };
}

/**
 * 成本展示的唯一入口。
 *
 * 未收录价格的模型走 costSource='unknown'，其 costUsd 恒为 0 ——
 * 直接渲染成 `$0.0000` 会让用户以为「这次真的没花钱」。
 * 不可知就显示 `—`，这也是本文件顶部注释里「宁可留空也不编价格」的下半句。
 */
export function formatCost(
  cost: number,
  costSource: CostSource | null | undefined,
  currency: PriceCurrency | null | undefined = 'USD',
  digits = 4,
): string {
  return costSource === 'unknown' || costSource === null || costSource === undefined
    ? '—'
    : `${CURRENCY_SYMBOL[currency ?? 'USD']}${cost.toFixed(digits)}`;
}
