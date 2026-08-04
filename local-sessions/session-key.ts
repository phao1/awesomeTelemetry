import { createHash } from 'node:crypto';

import type { ProviderKey } from '../src/core/trace-types.js';

/** REQ-007 / G4.7：provider- + SHA1(provider:id:sourcePath) 前 14 位。 */
export function sessionKey(provider: ProviderKey, id: string, sourcePath: string): string {
  const hash = createHash('sha1')
    .update(`${provider}:${id}:${sourcePath}`)
    .digest('hex');
  return `${provider}-${hash.slice(0, 14)}`;
}
