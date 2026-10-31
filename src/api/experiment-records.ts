import { fetchJson } from './client.js';

// Frozen transport shapes: openspec/contracts/experiment-records.md EXP-001.
export type ExperimentLabel = 'pass' | 'fail' | 'mixed' | 'unrated';
export interface ExperimentRun { sessionKey: string; label: ExperimentLabel; note: string | null }
export interface ExperimentInput {
  name: string; task: string | null; inputVersion: string | null;
  modelParameters: string | null; toolSet: string | null;
  mode: 'controlled' | 'natural'; runs: ExperimentRun[];
}
export interface ExperimentRecord extends ExperimentInput { id: string; createdAt: string; updatedAt: string }
export interface ExperimentSnapshot { version: 1; revision: number; records: ExperimentRecord[] }
export const experimentRecords = {
  list: (signal: AbortSignal): Promise<ExperimentSnapshot> => fetchJson('/experiment-records', { signal }),
  write: (action: 'create' | 'update' | 'delete', id: string | null, expectedRevision: number, record: ExperimentInput | null, signal: AbortSignal): Promise<ExperimentSnapshot> => fetchJson(`/experiment-records${action === 'create' ? '' : '/' + encodeURIComponent(id ?? '')}`, {
    method: action === 'create' ? 'POST' : action === 'update' ? 'PUT' : 'DELETE', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action === 'delete' ? { confirmed: true, expectedRevision } : { confirmed: true, expectedRevision, record }),
  }),
};
