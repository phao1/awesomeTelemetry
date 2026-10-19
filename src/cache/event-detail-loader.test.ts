import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TraceEvent } from '../core/trace-types.js';
import { eventDetailCache } from './caches.js';
import { loadEventDetailCached } from './event-detail-loader.js';

afterEach(() => eventDetailCache.clear());
const event: TraceEvent = { id: 'e1', sessionId: 's', sequence: 1, turnKey: null, kind: 'file_read', phase: 'implement',
  title: 'Read synthetic file', startedAt: '2026-10-17T00:00:00.000Z', durationMs: 100, status: 'success',
  actor: 'assistant', tool: 'Read', tokens: null, error: null, hasInput: true, hasOutput: true, hasRaw: true,
  inputSummary: 'synthetic.txt', outputSummary: 'SYNTHETIC' };

describe('WB-002 selected-record request ownership', () => {
  it('shares one pending request and the retained LRU result across two surfaces', async () => {
    let complete!: (event: TraceEvent) => void;
    const load = vi.fn(() => new Promise<TraceEvent>(resolve => { complete = resolve; }));
    const first = loadEventDetailCached('s:e1', load);
    const second = loadEventDetailCached('s:e1', load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    complete(event);
    expect(await first).toBe(event); expect(await second).toBe(event);
    expect(await loadEventDetailCached('s:e1', load)).toBe(event);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('does not let an old request repopulate a cleared cache or replace a new epoch result', async () => {
    let complete!: (event: TraceEvent) => void;
    const old = loadEventDetailCached('s:e1', () => new Promise<TraceEvent>(resolve => { complete = resolve; }));
    await Promise.resolve(); eventDetailCache.clear();
    const fresh = { ...event, title: 'fresh epoch' };
    await loadEventDetailCached('s:e1', async () => fresh);
    complete(event); await old;
    expect(eventDetailCache.get('s:e1')).toBe(fresh);
  });
  it('retries a failed request without caching the failure or merging body and raw tiers', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(event);
    await expect(loadEventDetailCached('s:e1', load)).rejects.toThrow('offline');
    expect(await loadEventDetailCached('s:e1', load)).toBe(event);
    const raw = vi.fn(async () => ({ ...event, raw: 'ORIGINAL' }));
    expect(await loadEventDetailCached('s:e1:raw', raw)).toEqual({ ...event, raw: 'ORIGINAL' });
    expect(load).toHaveBeenCalledTimes(2); expect(raw).toHaveBeenCalledTimes(1);
  });
});
