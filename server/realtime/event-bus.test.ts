import { describe, expect, it } from 'vitest';

import { TypedEventBus, eventBus } from './event-bus.js';

describe('REQ-001/002 TypedEventBus', () => {
  it('on/emit/退订', () => {
    const bus = new TypedEventBus();
    const seen: string[] = [];
    const unsub = bus.on('session_created', (p) => seen.push(p.key));
    bus.emit('session_created', { key: 'k1', provider: 'codex' });
    expect(seen).toEqual(['k1']);
    unsub();
    bus.emit('session_created', { key: 'k2', provider: 'codex' });
    expect(seen).toEqual(['k1']);
    expect(bus.listenerCount('session_created')).toBe(0);
  });

  it('多监听者互不影响，移除只删自己', () => {
    const bus = new TypedEventBus();
    let a = 0;
    let b = 0;
    const unsubA = bus.on('sessions_changed', () => { a += 1; });
    bus.on('sessions_changed', () => { b += 1; });
    bus.emit('sessions_changed', { keys: ['k'], count: 1 });
    unsubA();
    bus.emit('sessions_changed', { keys: ['k'], count: 1 });
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('eventBus 是模块级单例', () => {
    expect(eventBus).toBeInstanceOf(TypedEventBus);
    expect(eventBus.totalListenerCount()).toBe(0);
  });

  it('禁止契约之外的事件（编译期）', () => {
    // @ts-expect-error REQ-001：MUST NOT 定义契约之外的事件（session_updated 不存在）
    eventBus.emit('session_updated', { key: 'x' });
  });
});
