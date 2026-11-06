import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// OpenCode pinned commit: packages/core/src/session/sql.ts SessionTable.
export function sessionTokens(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT id, tokens_input, tokens_output, tokens_reasoning,
      tokens_cache_read, tokens_cache_write FROM session_v2`).all();
    if (!rows.length) throw new Error('No sessions in exported database');
    const total = { input: 0, output: 0, reasoning: 0, cached: 0, cacheWrite: 0, total: 0, sessions: rows.length };
    for (const row of rows) {
      total.input += row.tokens_input;
      total.output += row.tokens_output;
      total.reasoning += row.tokens_reasoning;
      total.cached += row.tokens_cache_read;
      total.cacheWrite += row.tokens_cache_write;
    }
    // Native OpenCode input/output exclude cached/reasoning subsets (see session/usage.ts).
    total.total = total.input + total.output + total.reasoning + total.cached + total.cacheWrite;
    return total;
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(sessionTokens(process.argv[2])));
}
