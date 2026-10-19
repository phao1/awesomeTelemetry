import { parentPort, workerData } from 'node:worker_threads';
import { extractTraceArchive } from './archive.js';
import { limit, parseTrace, TraceImportError } from './format.js';

const data = workerData as { path: string; directory: string; archive: boolean };
async function run(): Promise<void> {
  const extracted = data.archive ? await extractTraceArchive(data.path, data.directory)
    : { files: [{ path: data.path, member: null }], ignoredEntries: 0 };
  const traces = []; let count = 0;
  for (const file of extracted.files) {
    const trace = await parseTrace(file.path, file.member); count += trace.turns.length; if (count > 2000) limit(); traces.push(trace);
  }
  parentPort!.postMessage({ ok: true, traces, ignoredEntries: extracted.ignoredEntries });
}
void run().catch((error: unknown) => {
  const ioFailure = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^E[A-Z]+$/.test(error.code);
  parentPort!.postMessage({ ok: false, code: error instanceof TraceImportError ? error.code : ioFailure ? 'TRACE_IMPORT_FAILED' : 'TRACE_IMPORT_INVALID' });
});
