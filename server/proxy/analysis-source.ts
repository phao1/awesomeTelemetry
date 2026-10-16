import { createHash } from 'node:crypto';
import { decodeBodyBytes } from './body-decoder.js';

import type { CaptureBodyRef } from '../../src/core/trace-types.js';
import type { CaptureBodyStore } from './body-store.js';

export type AnalysisSourceReason =
  | 'original_deleted'
  | 'source_too_large'
  | 'decoded_too_large'
  | 'capture_incomplete'
  | 'source_unavailable'
  | 'source_integrity_failed'
  | 'invalid_utf8'
  | 'unsupported_content_encoding'
  | 'decode_failed';

export type AnalysisBodyResult =
  | { ok: true; body: string }
  | { ok: false; reason: AnalysisSourceReason };

/** On-demand bounded read. Never substitutes a preview for a damaged original. */
export async function readAnalysisBody(
  store: Pick<CaptureBodyStore, 'openRead'>,
  ref: CaptureBodyRef,
  maxBytes = 2 * 1024 * 1024,
  options: { allowIncomplete?: boolean; contentEncoding?: string | null } = {},
): Promise<AnalysisBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('Invalid analysis limit');
  if (ref.status !== 'complete' && options.allowIncomplete !== true) return { ok: false, reason: 'capture_incomplete' };
  if (ref.bytes > maxBytes) return { ok: false, reason: 'source_too_large' };
  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of store.openRead(ref.id)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) return { ok: false, reason: 'source_too_large' };
      hash.update(buffer);
      chunks.push(buffer);
    }
  } catch {
    return { ok: false, reason: 'source_unavailable' };
  }
  if (bytes !== ref.bytes || hash.digest('hex') !== ref.sha256) {
    return { ok: false, reason: 'source_integrity_failed' };
  }
  return decodeBodyBytes(Buffer.concat(chunks, bytes), { contentEncoding: options.contentEncoding, maxBytes });
}
