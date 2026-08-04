import { normalizeClaudeSample, type ClaudeRawRow } from '../src/adapters/claude-code.js';
import { makeJsonlScanner } from './scanner-utils.js';

export const claudeScanner = makeJsonlScanner('claude', (rows, filePath) =>
  normalizeClaudeSample(
    { sourceAgent: 'Claude', session: {}, events: rows as ClaudeRawRow[] },
    filePath,
  ),
);
