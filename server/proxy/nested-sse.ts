/**
 * One documented Qoder gateway envelope, not a generic recursive decoder.
 * The caller owns SSE framing, source-size admission, protocol projection and
 * original retention. This helper only parses the string at the exact .body
 * locator; it never mutates/replaces the captured SSE frame.
 */
export type QoderSseFrame =
  | { kind: 'frame'; frame: Record<string, unknown>; sourcePathSuffix: '.body' }
  | {
    kind: 'invalid';
    reason: 'qoder_body_limit' | 'qoder_body_invalid' | 'qoder_inner_shape' | 'qoder_status';
    statusCode: string | null;
    sourcePathSuffix: '.body' | '.statusCode';
  };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function unwrapQoderSseFrame(value: unknown): QoderSseFrame | null {
  const outer = record(value);
  if (outer === null || record(outer.headers) === null || typeof outer.statusCode !== 'string' || !Object.hasOwn(outer, 'body')) return null;
  const statusCode = outer.statusCode;
  if (statusCode !== 'OK') return { kind: 'invalid', reason: 'qoder_status', statusCode, sourcePathSuffix: '.statusCode' };
  if (typeof outer.body !== 'string') return { kind: 'invalid', reason: 'qoder_body_invalid', statusCode, sourcePathSuffix: '.body' };
  if (Buffer.byteLength(outer.body, 'utf8') > 2 * 1024 * 1024) {
    return { kind: 'invalid', reason: 'qoder_body_limit', statusCode, sourcePathSuffix: '.body' };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(outer.body) as unknown; }
  catch { return { kind: 'invalid', reason: 'qoder_body_invalid', statusCode, sourcePathSuffix: '.body' }; }
  const frame = record(parsed);
  if (frame === null || frame.object !== 'chat.completion.chunk' || !Array.isArray(frame.choices)) {
    return { kind: 'invalid', reason: 'qoder_inner_shape', statusCode, sourcePathSuffix: '.body' };
  }
  return { kind: 'frame', frame, sourcePathSuffix: '.body' };
}
