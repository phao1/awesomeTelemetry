import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import type { ProviderKey } from '../src/core/trace-types.js';

/** REQ-007 / G4.7：provider- + SHA1(provider:id:sourcePath) 前 14 位。 */
export function sessionKey(provider: ProviderKey, id: string, sourcePath: string): string {
  const hash = createHash('sha1')
    .update(`${provider}:${id}:${sourcePath}`)
    .digest('hex');
  return `${provider}-${hash.slice(0, 14)}`;
}

/**
 * T-02 统一口径（索引阶段与详情阶段 MUST 使用同一函数，禁止两处各算各的）：
 * - JSONL 类（每文件一会话）：innerId 缺省 → 稳定来源标识 = 文件名
 * - SQLite 类（一库多会话）：innerId = db 行内 session id
 * 关键约束：索引阶段拿得到、详情阶段算得出同一个值。
 */
export function deriveSessionKey(
  provider: ProviderKey,
  sourcePath: string,
  innerId?: string,
): string {
  return sessionKey(provider, innerId ?? basename(sourcePath), sourcePath);
}
