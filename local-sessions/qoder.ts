import { normalizeQoderSample, type QoderRawRow } from '../src/adapters/qoder.js';
import { makeJsonlScanner } from './scanner-utils.js';

export const qoderScanner = makeJsonlScanner('qoder', (rows, filePath) =>
  normalizeQoderSample(
    { sourceAgent: 'Qoder', session: { id: 'qoder' }, events: rows as QoderRawRow[] },
    filePath,
  ),
);
