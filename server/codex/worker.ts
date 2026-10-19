import { parentPort, workerData } from 'node:worker_threads';
import { projectCodex, type CodexProjectionWindow } from './projector.js';
import { CodexInspectionError } from './archive.js';
import type { CodexSource } from './source.js';

const input = workerData as { source: CodexSource; selected?: number; window?: CodexProjectionWindow };
if (parentPort !== null) {
  const port = parentPort;
  void projectCodex(input.source, input.selected, undefined, input.window).then(result => {
    if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
    port.postMessage({ result });
  }).catch((error: unknown) => port.postMessage({ error: error instanceof CodexInspectionError ? error.code : 'CODEX_INSPECTION_FAILED' }));
}
