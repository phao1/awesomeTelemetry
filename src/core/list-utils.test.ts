import { describe, expect, it } from 'vitest';

import type { SessionIndexEntry } from './trace-types.js';
import { mergeSessionsPatch } from './list-utils.js';

function entry(id: string, startedAt: string): SessionIndexEntry {
  return {
    id,
    provider: 'codex',
    sourceAgent: 'Codex',
    title: id,
    startedAt,
    updatedAt: startedAt,
    status: 'success',
    cwd: null,
    eventCount: 0,
    messageCount: 0,
    tokenTotal: 0,
    costUsd: 0,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}`,
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
    tags: [],
  };
}

describe('REQ-004 mergeSessionsPatch', () => {
  it('patch 覆盖同名 key 并按 startedAt 降序', () => {
    const existing = [entry('a', '2026-08-01T00:00:00.000Z'), entry('b', '2026-08-02T00:00:00.000Z')];
    const patch = [entry('a', '2026-08-03T00:00:00.000Z'), entry('c', '2026-08-01T12:00:00.000Z')];
    const merged = mergeSessionsPatch(existing, patch);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(merged[0]?.title).toBe('a');
  });

  it('去重', () => {
    const merged = mergeSessionsPatch([entry('a', 'x')], [entry('a', 'x')]);
    expect(merged).toHaveLength(1);
  });
});
