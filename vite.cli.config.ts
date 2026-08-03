import { defineConfig } from 'vite';

// 第三阶段：把 server/cli.ts 打成单文件 server-dist/cli.js
// 原生模块与重依赖不打包，由 pack-binary 复制 node_modules
export default defineConfig({
  build: {
    ssr: 'server/cli.ts',
    outDir: 'server-dist',
    target: 'node20',
    sourcemap: true,
    rollupOptions: {
      external: ['better-sqlite3', 'chokidar', 'http-mitm-proxy', 'node-forge'],
      output: { entryFileNames: 'cli.js', format: 'es' },
    },
  },
});
