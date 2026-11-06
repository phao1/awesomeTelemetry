import { defineConfig } from 'vite';

// Third stage: CLI and actual Node worker entries; shared chunks stay beside them.
// 原生模块与重依赖不打包，由 pack-binary 复制 node_modules
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'server-dist',
    target: 'node20',
    sourcemap: true,
    rollupOptions: {
      input: { rsi: 'server/rsi/cli.ts', 'telemetry-worker': 'server/telemetry/worker.ts', cli: 'server/cli.ts', benchmark: 'server/benchmark/cli.ts', 'team-experiment': 'server/team-experiment/cli.ts', 'agent-folding': 'server/agent-folding/cli.ts', 'capture-worker': 'server/proxy/capture-worker.ts', 'trace-import-worker': 'server/trace-import/worker.ts', 'codex-worker': 'server/codex/worker.ts' },
      external: ['better-sqlite3', 'chokidar', 'http-mitm-proxy', 'node-forge'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        format: 'es',
      },
    },
  },
});
