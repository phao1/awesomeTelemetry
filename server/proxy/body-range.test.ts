import { describe, expect, it } from 'vitest';
import { parseBodyByteRange } from './body-range.js';

describe('original byte download selection (not storage-capacity testing)', () => {
  it.each([
    [undefined, 10, null], ['bytes=2-5', 10, { start: 2, end: 5 }],
    ['bytes=2-', 10, { start: 2, end: 9 }], ['bytes=-3', 10, { start: 7, end: 9 }],
    ['bytes=-30', 10, { start: 0, end: 9 }], ['bytes=2-30', 10, { start: 2, end: 9 }],
    ['bytes=0-0', 10, { start: 0, end: 0 }], ['bytes=9-', 10, { start: 9, end: 9 }],
    ['bytes=10-', 10, 'unsatisfiable'], ['bytes=-0', 10, 'unsatisfiable'],
    ['bytes=0-', 0, 'unsatisfiable'], [undefined, 0, null],
    ['bytes=-', 10, 'invalid'], ['bytes=5-2', 10, 'invalid'], ['bytes=0-2,5-6', 10, 'invalid'],
    ['items=0-2', 10, 'invalid'], ['bytes=NaN-2', 10, 'invalid'], ['bytes=1.5-2', 10, 'invalid'],
    ['bytes=9007199254740993-', 10, 'invalid'], ['bytes=' + '1'.repeat(257) + '-', 10, 'invalid'],
  ] as const)('selects %s from %s observed bytes', (header, bytes, expected) => {
    expect(parseBodyByteRange(header, bytes)).toEqual(expected);
  });
});
