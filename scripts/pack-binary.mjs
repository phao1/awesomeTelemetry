#!/usr/bin/env node
// REQ-008：复制 server-dist/ + dist/ + bin/ + node_modules + package.json 到 dist-binary/，
// 生成平台启动器；Windows 用 .ps1（UTF-8），不用 .bat（G2.1 中文路径乱码）。
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = join(here, '..');

export function packBinary({
  root = defaultRoot,
  outDir,
  includeNodeModules = true,
}) {
  const required = includeNodeModules
    ? ['dist', 'server-dist', 'bin', 'node_modules', 'package.json']
    : ['dist', 'server-dist', 'bin', 'package.json'];
  for (const item of required) {
    if (!existsSync(join(root, item))) {
      throw new Error(`缺少构建产物: ${item}（先执行 npm run build）`);
    }
  }
  mkdirSync(outDir, { recursive: true });
  for (const item of required) {
    cpSync(join(root, item), join(outDir, item), { recursive: true });
  }

  // Windows 启动器：.ps1，UTF-8 编码
  writeFileSync(
    join(outDir, 'agent-observe.ps1'),
    `# Agent Observability 启动器（UTF-8）
$ErrorActionPreference = 'Stop'
node "$PSScriptRoot\\bin\\agent-observe.js" @args
`,
    'utf8',
  );
  // Unix 启动器
  writeFileSync(
    join(outDir, 'agent-observe.sh'),
    `#!/usr/bin/env sh
exec node "$(dirname "$0")/bin/agent-observe.js" "$@"
`,
    'utf8',
  );
  return outDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf('--out');
  const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : join(defaultRoot, 'dist-binary');
  const skipModules = process.argv.includes('--skip-modules');
  const target = packBinary({ outDir, includeNodeModules: !skipModules });
  console.log(`packed to ${target}`);
}
