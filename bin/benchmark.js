#!/usr/bin/env node
try {
  const { runBenchmarkCli } = await import('../server-dist/benchmark.js');
  await runBenchmarkCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
