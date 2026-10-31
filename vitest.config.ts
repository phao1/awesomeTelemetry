import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // 合并窗口等定时器必须 unref，否则这里会挂住（G11.8）
    testTimeout: 15_000,
    // These files include hard wall-clock/loop-delay budgets. Running separate
    // workloads together measures scheduler contention, not their NFR budget.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['{server,local-sessions,scripts}/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          environmentOptions: { jsdom: { url: 'http://localhost/' } },
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
