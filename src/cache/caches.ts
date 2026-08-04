import type {
  SessionDetailResponse,
  TraceEvent,
  TraceEventRaw,
} from '../core/trace-types.js';
import { LruCache } from './lru.js';

/** REQ-005：双层缓存。 */
export const recordCache = new LruCache<SessionDetailResponse>(30);
export const eventDetailCache = new LruCache<TraceEvent | TraceEventRaw>(100);

export function invalidateSessionDetail(key: string): void {
  recordCache.delete(`${key}:slim`);
  recordCache.delete(`${key}:full`);
}
