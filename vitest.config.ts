import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['{src,server,local-sessions}/**/*.test.{ts,tsx}'],

    // ⚠️ 仅 M0 空测试期使用。M1 交付 trace-types.test.ts 后必须删掉这一行。
    // 保留它会让"测试根本没被发现"这类故障静默通过 —— 与 scan_state 静默失败同类。
    // 删除时机见 BOOTSTRAP.md M1 验收。
    passWithNoTests: true,

    // 合并窗口等定时器必须 unref，否则这里会挂住（G11.8）
    testTimeout: 15_000,
  },
});
