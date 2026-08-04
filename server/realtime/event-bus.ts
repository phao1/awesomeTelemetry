import type { BusEvents } from '../../src/core/trace-types.js';

/** REQ-001：事件名严格限定为 BusEvents 的键，禁止契约之外的事件。 */
export type BusEventName = keyof BusEvents;

type AnyListener = (payload: never) => void;

export class TypedEventBus {
  private readonly listeners = new Map<BusEventName, Set<AnyListener>>();

  on<E extends BusEventName>(name: E, listener: (payload: BusEvents[E]) => void): () => void {
    let set = this.listeners.get(name);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as AnyListener);
    return () => {
      set.delete(listener as AnyListener);
    };
  }

  emit<E extends BusEventName>(name: E, payload: BusEvents[E]): void {
    const set = this.listeners.get(name);
    if (set === undefined) {
      return;
    }
    for (const listener of [...set]) {
      (listener as (p: BusEvents[E]) => void)(payload);
    }
  }

  listenerCount(name: BusEventName): number {
    return this.listeners.get(name)?.size ?? 0;
  }

  totalListenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

/** REQ-002：模块级单例，全应用共享。 */
export const eventBus = new TypedEventBus();
