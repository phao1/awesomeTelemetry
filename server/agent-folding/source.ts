import type { ReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

export const FOLDING_SOURCE_BYTE_LIMIT = 512 * 1024 * 1024;
export type FoldingSourceReason = 'SOURCE_CHANGED' | 'UNINDEXED' | 'TOO_LARGE' | 'NO_MATCH' | 'INVALID_SOURCE';
export class FoldingSourceError extends Error {
  readonly code: FoldingSourceReason;
  readonly reason: FoldingSourceReason;
  readonly details: Record<string, string | number>;
  constructor(reason: FoldingSourceReason, message: string, details: Record<string, string | number> = {}) {
    super(message); this.name = 'FoldingSourceError'; this.code = reason; this.reason = reason; this.details = details;
  }
}
export interface SourceBudget { bytes: number; limit: number; files: Map<string, number> }
const jobBudgets = new WeakMap<AbortSignal, SourceBudget>();
export function sourceBudget(signal?: AbortSignal, limit = FOLDING_SOURCE_BYTE_LIMIT): SourceBudget {
  if (!signal) return { bytes: 0, limit, files: new Map() };
  let budget = jobBudgets.get(signal);
  if (!budget) { budget = { bytes: 0, limit, files: new Map() }; jobBudgets.set(signal, budget); }
  return budget;
}
function accountSourceFile(budget: SourceBudget, key: string, size: number) {
  const previous = budget.files.get(key) ?? 0;
  if (size > previous) {
    budget.bytes += size - previous;
    budget.files.set(key, size);
  }
  if (budget.bytes > budget.limit) throw new FoldingSourceError('TOO_LARGE', 'Native source byte budget exceeded.', { bytes: budget.bytes, limit: budget.limit });
}
/** Charge each retained file once across all readers/groups in the owned job. */
export async function openSourceStream(path: string, budget: SourceBudget, signal?: AbortSignal): Promise<ReadStream> {
  signal?.throwIfAborted();
  const file = await open(path, 'r');
  try {
    const metadata = await file.stat(), key = `${metadata.dev}:${metadata.ino}`;
    if (metadata.isFile()) accountSourceFile(budget, key, metadata.size);
    signal?.throwIfAborted();
    const stream = file.createReadStream({ signal });
    let bytes = 0;
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      // Growth during a read is charged too; the caller still checks source changes.
      try { accountSourceFile(budget, key, bytes); }
      catch (error) { stream.destroy(error as Error); }
    });
    return stream;
  } catch (error) { await file.close(); throw error; }
}
export function unavailableSource(error: unknown): boolean {
  return ['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EIO'].includes(String((error as NodeJS.ErrnoException)?.code));
}
/** Opening verifies readability too. A missing marker participates in both revision checks. */
export async function sourceFingerprint(path: string): Promise<unknown> {
  try {
    const file = await open(path, 'r');
    try { const s = await file.stat(); return s.isFile() ? [s.size, s.mtimeMs, s.ino] : 'missing'; }
    finally { await file.close(); }
  } catch (error) { if (unavailableSource(error)) return 'missing'; throw error; }
}
/** Escaped JSON property/value names must still reach the parser. False positives are harmless. */
export function relevantSourceLine(line: string, terms: readonly string[]): boolean {
  return line.includes('\\u') || terms.some(term => line.includes(term));
}
