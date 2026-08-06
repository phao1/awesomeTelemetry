import type { TraceEvent } from './trace-types.js';

/** FNV-1a 64bit（BigInt 实现），输出 16 位小写 hex。 */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * fix-session-detail-display 1.5：事件内容哈希。
 * 输入为全部**可变列**的规范化 JSON 数组——adapter 升级后重解析出
 * 新 duration / input / output 时，同 (id, sequence) 也能被检测为内容变化并
 * 触发 UPDATE（差分写入判等依据）。
 */
export function eventContentHash(event: TraceEvent): string {
  const payload = JSON.stringify([
    event.kind,
    event.phase,
    event.title,
    event.startedAt,
    event.durationMs,
    event.status,
    event.actor,
    event.tool ?? '',
    event.inputSummary ?? '',
    event.outputSummary ?? '',
    event.tokens ?? null,
    event.error ?? '',
    event.model ?? '',
  ]);
  return fnv1a64(payload);
}
