#!/usr/bin/env node
try {
  const { runTaskHealthCli } = await import('../server-dist/task-health/cli.js');
  await runTaskHealthCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error && error.code === 'ERR_MODULE_NOT_FOUND' ? 'Build the task health CLI first: npm run build:task-health' : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
