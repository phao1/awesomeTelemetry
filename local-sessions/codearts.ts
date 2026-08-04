import { codeartsAdapter } from '../src/adapters/codearts.js';
import { makeSqliteScanner } from './scanner-utils.js';
import { readOpenCodeDb } from './opencode.js';

export const codeartsScanner = makeSqliteScanner('codearts', (dbPath, filePath) => {
  const sample = readOpenCodeDb(dbPath);
  return codeartsAdapter.normalize(
    { sourceAgent: 'CodeArts', session: sample.session, events: sample.messages },
    filePath,
  );
});
