import { codeagent2Adapter } from '../src/adapters/codeagent2.js';
import { makeSqliteScanner } from './scanner-utils.js';
import { readOpenCodeDb, readOpenCodeSessionIndex } from './opencode.js';

export const codeagent2Scanner = makeSqliteScanner(
  'codeagent2',
  (dbPath, filePath) =>
    readOpenCodeDb(dbPath).map((sample) =>
      codeagent2Adapter.normalize(
        { sourceAgent: 'CodeMate', session: sample.session, events: sample.messages },
        filePath,
      ),
    ),
  readOpenCodeSessionIndex,
);
