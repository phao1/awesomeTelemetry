import { expect, it } from 'vitest';
import { intersect, peak, partition, subtract, union, unionDuration } from './intervals.js';
it('keeps sum distinct from a fully overlapping union without mutating input', () => { const a: [
    number,
    number
][] = [[0, 10000], [0, 10000]]; expect(unionDuration(a)).toBe(10000); expect(a).toEqual([[0, 10000], [0, 10000]]); expect(peak(a)).toBe(2); });
it('touching endpoints merge but do not overlap', () => { expect(union([[1, 2], [0, 1]])).toEqual([[0, 2]]); expect(peak([[0, 1], [1, 2]])).toBe(1); });
it('rejects invalid/unbounded intervals and clips points', () => { expect(unionDuration([[2, 1], [NaN, 4], [0, Infinity]])).toBe(0); expect(intersect([0, 20], [5, 15])).toEqual([5, 15]); expect(intersect([0, 5], [5, 10])).toEqual([5, 5]); expect(intersect([0, 1], [2, 3])).toBeNull(); });
it('sweeps explicit priority and reconciles wall time', () => { expect(partition([0, 20], [{ key: 'user', intervals: [[2, 4]] }, { key: 'work', intervals: [[0, 10], [8, 15]] }], 'other')).toEqual({ user: 2, work: 13, other: 5 }); expect(subtract([[0, 20]], [[2, 4], [10, 30]])).toEqual([[0, 2], [4, 10]]); });
