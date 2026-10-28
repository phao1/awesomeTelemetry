import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const required = ['bin/agent-observe.js', 'bin/benchmark.js', 'bin/team-experiment.js', 'dist/index.html', 'server-dist/cli.js', 'server-dist/benchmark.js', 'server-dist/team-experiment.js', 'server-dist/capture-worker.js', 'server-dist/trace-import-worker.js', 'server-dist/codex-worker.js', 'config/benchmark.example.json', 'config/team-experiment.example.json', 'docs/benchmark.md', 'docs/team-experiment.md', 'scripts/trae-extract-key.py', 'scripts/frida-chat-monitor-v2.js', 'scripts/frida-check-module.js'];
for (const path of required) if (!existsSync(resolve(root, path))) throw new Error(`Missing package artifact ${path}. Run npm install then npm run build before npm pack. Packing never rebuilds.`);
const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) if (!existsSync(resolve(root, `dist${match[1]}`))) throw new Error(`Missing frontend asset ${match[1]}`);
if (!readdirSync(resolve(root, 'dist/assets')).some(file => file.endsWith('.js'))) throw new Error('Missing built frontend JavaScript');
console.log('Package build artifacts verified (no rebuild). Publication remains disabled until package ownership is confirmed.');
