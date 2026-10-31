#!/usr/bin/env node
try {
  const { runTeamExperimentCli } = await import('../server-dist/team-experiment.js');
  await runTeamExperimentCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
