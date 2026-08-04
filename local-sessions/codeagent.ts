import type { ClaudeRawRow } from '../src/adapters/claude-code.js';
import { codeAgentAdapter } from '../src/adapters/codeagent.js';
import { makeJsonlScanner } from './scanner-utils.js';

export const codeagentScanner = makeJsonlScanner('codeagent', (rows, filePath) =>
  codeAgentAdapter.normalize(
    { sourceAgent: 'CodeAgent', session: {}, events: rows as ClaudeRawRow[] },
    filePath,
  ),
);
