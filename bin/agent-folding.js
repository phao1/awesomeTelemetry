#!/usr/bin/env node
try {
  const { runAgentFoldingCli } = await import('../server-dist/agent-folding.js');
  await runAgentFoldingCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
