import {
  normalizeWorkBuddySample,
  type WorkBuddyRawMessage,
} from '../src/adapters/workbuddy.js';
import { makeJsonlScanner } from './scanner-utils.js';

export const workbuddyScanner = makeJsonlScanner('workbuddy', (rows, filePath) =>
  normalizeWorkBuddySample(
    { sourceAgent: 'WorkBuddy', session: { id: 'workbuddy' }, events: rows as WorkBuddyRawMessage[] },
    filePath,
  ),
);
