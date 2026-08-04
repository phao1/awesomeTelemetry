import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['{src,server,local-sessions,scripts}/**/*.test.{ts,tsx}'],

    // 合并窗口等定时器必须 unref，否则这里会挂住（G11.8）
    testTimeout: 15_000,
  },
});
