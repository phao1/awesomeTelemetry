// Vitest 全局 setup。
// Node ≥ 22 的 experimental webstorage 会遮蔽 jsdom 的 window.localStorage
// （无 --localstorage-file 时为 undefined），这里补最小 polyfill（DOM 能力，
// 不是 mock 被测逻辑）。
const storage = new Map<string, string>();

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      storage.set(key, String(value));
    },
    removeItem: (key: string): void => {
      storage.delete(key);
    },
    clear: (): void => {
      storage.clear();
    },
    key: (index: number): string | null => [...storage.keys()][index] ?? null,
    get length(): number {
      return storage.size;
    },
  },
});

export {};
