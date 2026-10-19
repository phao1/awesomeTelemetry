import type { TraceEvent } from '../core/trace-types.js';
import { eventDetailCache } from './caches.js';

const pending = new Map<string, { generation: number; promise: Promise<TraceEvent> }>();

/** One active request per selected event/tier; failures and invalidated results are not retained. */
export function loadEventDetailCached<T extends TraceEvent>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = eventDetailCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached as T);
  const generation = eventDetailCache.generation;
  const active = pending.get(key);
  if (active?.generation === generation) return active.promise as Promise<T>;
  const promise = Promise.resolve().then(load).then(value => {
    if (eventDetailCache.generation === generation) eventDetailCache.set(key, value);
    return value;
  }).finally(() => {
    if (pending.get(key)?.promise === promise) pending.delete(key);
  });
  pending.set(key, { generation, promise });
  return promise;
}
