#!/usr/bin/env node
import { existsSync } from 'node:fs';

const entry = new URL('../server-dist/cli.js', import.meta.url);
if (!existsSync(entry)) {
  console.error('AwesomeTelemetry build is missing. Source checkout: npm install && npm run build, then npm start -- web. Installed package: reinstall a complete package. No build is run automatically.');
  process.exitCode = 1;
} else {
  try {
    const { runCli } = await import(entry.href);
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
