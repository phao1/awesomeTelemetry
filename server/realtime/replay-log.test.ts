import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetadataReplayLog } from './replay-log.js';
import { TypedEventBus } from './event-bus.js';

afterEach(() => vi.useRealTimers());

describe('bounded metadata replay', () => {
  it('records emitted metadata even with no subscribers, never original chunks', () => {
    const log = new MetadataReplayLog();
    const bus = new TypedEventBus((name, payload) => log.record(name, payload));
    const start = log.cursor;
    bus.emit('sessions_changed', { keys: ['one'], count: 1 });
    bus.emit('proxy_stream_chunk', { requestId: 'private', chunk: 'secret body' });
    bus.emit('proxy_sources_changed', { requestIds: ['private-source-hint'] });
    bus.emit('proxy_request', { id: 7, hostname: 'gateway' });
    const replay = log.resume(start);
    expect(replay.resume).toBe('replayed');
    expect(replay.frames).toHaveLength(2);
    expect(replay.frames.join('')).not.toContain('secret body');
    expect(replay.frames.join('')).not.toContain('private-source-hint');
    expect(replay.frames.join('')).toContain('"id":7');
    expect(log.resume(log.cursor).frames).toEqual([]);
  });

  it('bounds frame count, byte length and expiry with explicit reset, not partial replay', () => {
    vi.useFakeTimers();
    const log = new MetadataReplayLog();
    const oldest = log.cursor;
    for (let i = 0; i < 513; i += 1) log.record('scan_completed', { provider: 'all', count: i });
    expect(log.resume(oldest)).toMatchObject({ resume: 'reset', frames: [] });
    expect(log.status().frames).toBe(512);
    const at = log.cursor;
    for (let i = 0; i < 10; i += 1) log.record('sessions_changed', { keys: ['x'.repeat(100_000)], count: 1 });
    expect(log.status().bytes).toBeLessThanOrEqual(512 * 1024);
    expect(log.resume(at).resume).toBe('reset');
    const before = log.cursor;
    log.record('scan_started', { provider: 'all' });
    vi.advanceTimersByTime(300_001);
    expect(log.resume(before).resume).toBe('reset');
    expect(log.status().frames).toBe(0);
  });

  it('resets foreign/future cursors and oversized gaps; a fresh connection does not replay history', () => {
    const log = new MetadataReplayLog();
    const before = log.cursor;
    log.record('sessions_changed', { keys: ['x'.repeat(300_000)], count: 1 });
    expect(log.resume(before)).toMatchObject({ resume: 'reset', frames: [] });
    expect(log.resume('foreign:12').resume).toBe('reset');
    expect(log.resume(log.cursor.replace(/:\d+$/, ':999999')).resume).toBe('reset');
    expect(log.resume()).toMatchObject({ resume: 'fresh', frames: [] });
    const oldEpoch = log.cursor;
    log.clear();
    expect(log.resume(oldEpoch).resume).toBe('reset');
  });

  it('passes the emission cursor to every listener even with nested emissions', () => {
    const log = new MetadataReplayLog();
    const bus = new TypedEventBus((name, payload) => log.record(name, payload));
    const seen: Array<string | undefined> = [];
    bus.on('scan_started', () => bus.emit('scan_completed', { provider: 'all', count: 1 }));
    bus.on('scan_started', (_payload, cursor) => seen.push(cursor));
    bus.emit('scan_started', { provider: 'all' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/:1$/);
    expect(log.cursor).toMatch(/:2$/);
  });
});
