import type { SessionIndexEntry } from './trace-types.js';

/** REQ-004：把批量 patch 合并进现有列表并按 startedAt 降序重排。 */
export function mergeSessionsPatch(
  existing: SessionIndexEntry[],
  patch: SessionIndexEntry[],
): SessionIndexEntry[] {
  const byId = new Map<string, SessionIndexEntry>();
  for (const entry of existing) {
    byId.set(entry.id, entry);
  }
  for (const entry of patch) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.startedAt === b.startedAt) {
      return a.id < b.id ? 1 : -1;
    }
    return a.startedAt < b.startedAt ? 1 : -1;
  });
}
