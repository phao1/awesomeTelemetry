import { performance } from 'node:perf_hooks';

import { resolveRules, type RulesOverride } from './rules.js';

/** REQ-006：raw 保留默认关闭。 */
export const KEEP_RAW_BODIES_DEFAULT = false;

export interface DesensitizeOptions extends RulesOverride {
  keepRawBodies?: boolean;
}

export interface DesensitizeResult {
  text: string;
  /** REQ-007：超过预算被跳过时 true（不阻塞请求转发）。 */
  skipped: boolean;
}

/**
 * REQ-002：按顺序应用所有 enabled 规则；每个 global regex 在 replace 前
 * MUST 重置 lastIndex，否则会间歇性漏匹配。
 */
export function desensitizeChecked(
  text: string,
  opts: DesensitizeOptions = {},
  budgetMs = 5,
): DesensitizeResult {
  const started = performance.now();
  let out = text;
  for (const rule of resolveRules(opts)) {
    if (!rule.enabled) {
      continue;
    }
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, rule.replacement);
  }
  const elapsed = performance.now() - started;
  if (elapsed > budgetMs) {
    console.warn(`desensitize 超预算（${elapsed.toFixed(2)}ms > ${budgetMs}ms），已跳过`);
    return { text, skipped: true };
  }
  return { text: out, skipped: false };
}

export function desensitize(text: string, opts: DesensitizeOptions = {}): string {
  return desensitizeChecked(text, opts).text;
}

/** REQ-003：对对象指定字符串字段脱敏。 */
export function desensitizeObject<T extends Record<string, unknown>>(
  obj: T,
  opts: DesensitizeOptions = {},
  fields?: ReadonlyArray<keyof T & string>,
): T {
  const keys = fields ?? (Object.keys(obj) as Array<keyof T & string>);
  const copy = { ...obj };
  for (const key of keys) {
    const value = copy[key];
    if (typeof value === 'string') {
      copy[key] = desensitize(value, opts) as T[keyof T & string];
    }
  }
  return copy;
}

export function shouldKeepRawBodies(opts: DesensitizeOptions = {}): boolean {
  return opts.keepRawBodies ?? KEEP_RAW_BODIES_DEFAULT;
}
