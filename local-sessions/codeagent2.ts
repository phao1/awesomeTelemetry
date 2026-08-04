import { codeagent2Adapter } from '../src/adapters/codeagent2.js';
import { makeSqliteScanner } from './scanner-utils.js';
import { readOpenCodeDb } from './opencode.js';

export const codeagent2Scanner = makeSqliteScanner('codeagent2', (dbPath, filePath) => {
  const sample = readOpenCodeDb(dbPath);
  return codeagent2Adapter.normalize(
    { sourceAgent: 'CodeMate', session: sample.session, events: sample.messages },
    filePath,
  );
});
