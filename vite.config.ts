import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// M6 之后接入：import { localSessionsPlugin } from './local-sessions/vite-plugin';

export default defineConfig({
  plugins: [react() /*, localSessionsPlugin() */],
  server: {
    host: '127.0.0.1', // G3.1：不要用 localhost（华为代理 ProxyOverride 不含它）
    port: 5173,
    // T-01：dev 模式下 /api 请求代理到生产后端（npm start 监听 4173）
    proxy: {
      '/api': 'http://127.0.0.1:4173',
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
