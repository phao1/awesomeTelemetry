// Vitest 全局 setup。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

// jsdom 无 matchMedia：补最小桩（G-DS-3 用 addEventListener）。
const matchMediaListeners: Array<(event: { matches: boolean }) => void> = [];

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) => ({
    matches: query.includes('dark') ? false : false,
    media: query,
    addEventListener: (_type: string, cb: (event: { matches: boolean }) => void): void => {
      matchMediaListeners.push(cb);
    },
    removeEventListener: (_type: string, cb: (event: { matches: boolean }) => void): void => {
      const index = matchMediaListeners.indexOf(cb);
      if (index >= 0) {
        matchMediaListeners.splice(index, 1);
      }
    },
  }),
});

export {};
