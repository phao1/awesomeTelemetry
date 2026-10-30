import { normalizeClaudeSample, type ClaudeRawRow } from '../src/adapters/claude-code.js';
import { cachedStmt } from '../server/storage/stmt-cache.js';
import { deriveSessionKey } from './session-key.js';
import { enumerateSourceFiles, makeJsonlScanner, type ProviderScanner } from './scanner-utils.js';

const scanner = makeJsonlScanner('claude', (rows, filePath) =>
  normalizeClaudeSample(
    { sourceAgent: 'Claude', session: {}, events: rows as ClaudeRawRow[] },
    filePath,
  ),
);

export const claudeScanner: ProviderScanner = {
  ...scanner,
  scanFile(config, filePath, ctx) {
    const previous = cachedStmt(ctx.db,
      'SELECT parser_version FROM trace_identity_sources WHERE session_key = ?',
    ).get(deriveSessionKey('claude', filePath)) as { parser_version: number } | undefined;
    return scanner.scanFile(config, filePath, {
      ...ctx, force: ctx.force || (previous !== undefined && previous.parser_version < 3),
    });
  },
  async scanProvider(config, ctx) {
    const files = enumerateSourceFiles(config.path, 'jsonl');
    let scanned = 0, skipped = 0, eventCount = 0;
    for (const path of files) {
      const result = await claudeScanner.scanFile(config, path, ctx);
      if (result.skipped) skipped += 1;
      else scanned += 1;
      eventCount += result.eventCount;
    }
    return { provider: config.key, files: files.length, scanned, skipped, eventCount };
  },
};
