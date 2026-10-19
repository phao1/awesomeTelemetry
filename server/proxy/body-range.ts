/** Byte offsets refer to the encoded retained prefix, never decoded text. */
export type BodyByteRange = { start: number; end: number } | 'invalid' | 'unsatisfiable' | null;

export function parseBodyByteRange(header: string | undefined, bytes: number): BodyByteRange {
  if (header === undefined) return null;
  if (header.length > 256 || !Number.isSafeInteger(bytes) || bytes < 0) return 'invalid';
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (match === null || (match[1] === '' && match[2] === '')) return 'invalid';
  const first = match[1] === '' ? null : Number(match[1]);
  const last = match[2] === '' ? null : Number(match[2]);
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return 'invalid';
  if (first !== null && last !== null && last < first) return 'invalid';
  if (bytes === 0) return 'unsatisfiable';
  if (first === null) {
    if (last === 0) return 'unsatisfiable';
    return { start: Math.max(0, bytes - last!), end: bytes - 1 };
  }
  if (first >= bytes) return 'unsatisfiable';
  return { start: first, end: Math.min(last ?? bytes - 1, bytes - 1) };
}
