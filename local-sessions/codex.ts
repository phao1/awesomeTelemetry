import { normalizeCodexSample, type CodexRawRow } from '../src/adapters/codex.js';
import { makeJsonlScanner } from './scanner-utils.js';

export const codexScanner = makeJsonlScanner('codex', (rows, filePath) =>
  normalizeCodexSample(
    { sourceAgent: 'Codex', session: {}, events: rows as CodexRawRow[] },
    filePath,
  ),
);
