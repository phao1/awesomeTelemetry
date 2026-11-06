#!/usr/bin/env node
try {
  const { runRsiCli } = await import('../server-dist/rsi.js');
  await runRsiCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
