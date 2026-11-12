#!/usr/bin/env node
// REQ-008：复制 npm 运行资源与本平台的运行依赖，生成 .ps1 和 .sh 启动器。
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { excludedPackagePath } from './rsi-package-assets.mjs';
import { verifyPackage } from './verify-package.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = join(here, '..');

function runtimeModules(root) {
  const { packages } = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const modules = [];
  for (const [path, dependency] of Object.entries(packages)) {
    if (!path.startsWith('node_modules/') || dependency.dev) continue;
    const source = resolve(root, path);
    if (dependency.optional && !existsSync(source)) continue;
    if (!existsSync(source)) throw new Error(`缺少运行依赖: ${path}（先执行 npm ci）`);
    if (!lstatSync(source).isDirectory() || realpathSync(source) !== source) throw new Error(`运行依赖必须是本地目录: ${path}`);
    modules.push(path);
  }
  try {
    const Database = createRequire(join(root, 'package.json'))('better-sqlite3');
    new Database(':memory:').close();
  } catch (error) {
    throw new Error('无法加载本机 better-sqlite3；请先为当前系统和 Node 版本安装运行依赖。', { cause: error });
  }
  return modules;
}

export function packBinary({
  root = defaultRoot,
  outDir,
  includeNodeModules = true,
}) {
  const required = includeNodeModules
    ? ['dist', 'server-dist', 'bin', 'node_modules', 'package.json', 'package-lock.json']
    : ['dist', 'server-dist', 'bin', 'package.json'];
  for (const item of required) {
    if (!existsSync(join(root, item))) {
      throw new Error(`缺少构建产物: ${item}（先执行 npm run build）`);
    }
  }
  const sourceRoot = realpathSync(root);
  const files = verifyPackage(sourceRoot);
  const modules = includeNodeModules ? runtimeModules(sourceRoot) : [];
  const destination = resolve(outDir);
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || readdirSync(destination).length)) throw new Error('打包目录必须为空；请用 --out 选择新的输出目录。');
  mkdirSync(dirname(destination), { recursive: true });
  const stage = mkdtempSync(join(dirname(destination), '.awesome-telemetry-pack-'));
  try {
    for (const file of files) cpSync(join(sourceRoot, file), join(stage, file));
    for (const path of modules) {
      const source = join(sourceRoot, path);
      cpSync(source, join(stage, path), {
        recursive: true,
        filter: file => !excludedPackagePath(relative(source, file).split(sep).join('/')) && !lstatSync(file).isSymbolicLink(),
      });
    }

    // Windows 启动器：.ps1，UTF-8 编码
    writeFileSync(
      join(stage, 'agent-observe.ps1'),
      `# AwesomeTelemetry 启动器（UTF-8）
$ErrorActionPreference = 'Stop'
node "$PSScriptRoot\\bin\\agent-observe.js" @args
`,
      'utf8',
    );
    writeFileSync(
      join(stage, 'agent-observe.sh'),
      `#!/usr/bin/env sh
exec node "$(dirname "$0")/bin/agent-observe.js" "$@"
`,
      { encoding: 'utf8', mode: 0o755 },
    );
    if (existing) rmdirSync(destination);
    renameSync(stage, destination);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return outDir;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf('--out');
  const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : join(defaultRoot, 'dist-binary');
  const skipModules = process.argv.includes('--skip-modules');
  const target = packBinary({ outDir, includeNodeModules: !skipModules });
  console.log(`packed to ${target}`);
}
