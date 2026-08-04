import { codeartsAdapter } from '../src/adapters/codearts.js';
import { makeSqliteScanner } from './scanner-utils.js';
import { readOpenCodeDb, readOpenCodeSessionIndex } from './opencode.js';

export const codeartsScanner = makeSqliteScanner(
  'codearts',
  (dbPath, filePath) =>
    readOpenCodeDb(dbPath).map((sample) =>
      codeartsAdapter.normalize(
        { sourceAgent: 'CodeArts', session: sample.session, events: sample.messages },
        filePath,
      ),
    ),
  readOpenCodeSessionIndex,
);
