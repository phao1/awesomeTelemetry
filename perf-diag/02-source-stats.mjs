// Step 0b：源文件统计。依赖 local-sessions 配置（M6 才接线），
// 配置不存在时如实输出 N/A，不做假数字。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

const configPath = new URL('../config/local-sessions.local.json', import.meta.url).pathname;

if (!existsSync(configPath)) {
  console.log(`local-sessions.local.json 不存在（${configPath}），M6 接线后启用`);
  console.log('源文件数量 = N/A，源文件总量 = N/A（依赖真实配置，不做合成假设）');
  process.exit(0);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const providers = Object.values(config.providers ?? {});
let files = 0;
let bytes = 0;
for (const provider of providers) {
  const rawPath = provider.path ?? '';
  const expanded = rawPath.replace(/^~(?=\/|\\)/, homedir());
  if (!existsSync(expanded)) {
    console.log(`${provider.key}: 路径不存在 ${expanded}（N/A）`);
    continue;
  }
  // M6 扫描器接好后这里会换成真实的递归统计；当前只统计直接子项避免误报。
  const entries = readdirSync(expanded, { withFileTypes: true });
  let count = 0;
  let size = 0;
  for (const entry of entries) {
    if (entry.isFile()) {
      count += 1;
      size += statSync(`${expanded}/${entry.name}`).size;
    }
  }
  files += count;
  bytes += size;
  console.log(`${provider.key}: ${count} files / ${(size / 1024 / 1024).toFixed(2)}MB`);
}
console.log(`合计: ${files} files / ${(bytes / 1024 / 1024).toFixed(2)}MB`);
