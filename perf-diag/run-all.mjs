// perf:check 入口：顺序执行 7 个诊断脚本并输出分节结果。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = [
  '01-db-stats.mjs',
  '02-source-stats.mjs',
  '03-explain-plan.mjs',
  '04-query-timing.mjs',
  '05-overview-perf.mjs',
  '06-diff-write.mjs',
  '07-event-loop.mjs',
  '08-mission.mjs',
];

async function runScript(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, script)], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`${script} 启动失败: ${err.message}`);
      resolve(1);
    });
  });
}

let failed = false;
for (const script of scripts) {
  console.log(`\n===== ${script} =====`);
  const code = await runScript(script);
  if (code !== 0) {
    failed = true;
    console.error(`${script} 失败（exit=${code}）`);
  }
}

if (failed) {
  console.error('\nperf:check 有脚本失败');
  process.exit(1);
}
console.log('\nperf:check 完成');
