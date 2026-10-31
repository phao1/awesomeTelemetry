export type Interval = [
    number,
    number
];
export function union(intervals: readonly Interval[]): Interval[] {
    const result: Interval[] = [];
    for (const [s, e] of intervals.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).map(([a, b]): Interval => [a, b]).sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
        const last = result.at(-1);
        if (last && s <= last[1])
            last[1] = Math.max(last[1], e);
        else
            result.push([s, e]);
    }
    return result;
}
export const unionDuration = (intervals: readonly Interval[]): number => union(intervals).reduce((n, [s, e]) => n + e - s, 0);
export function intersect(a: Interval, b: Interval): Interval | null {
    const s = Math.max(a[0], b[0]), e = Math.min(a[1], b[1]);
    return e >= s ? [s, e] : null;
}
export function peak(intervals: readonly Interval[]): number {
    const points = intervals.filter(([s, e]) => e > s).flatMap(([s, e]) => [[s, 1], [e, -1]]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    let count = 0, max = 0;
    for (const [, d] of points) {
        count += d!;
        max = Math.max(max, count);
    }
    return max;
}
/** Half-open sweep; priority is the order of the supplied groups. */
export function partition<K extends string>(bounds: Interval, groups: readonly {
    key: K;
    intervals: readonly Interval[];
}[], fallback: K): Record<K, number> {
    const clipped = groups.map(g => ({ ...g, intervals: g.intervals.flatMap(i => { const c = intersect(i, bounds); return c ? [c] : []; }) }));
    const result = Object.fromEntries([...groups.map(g => [g.key, 0]), [fallback, 0]]) as Record<K, number>;
    const points = [...new Set([bounds[0], bounds[1], ...clipped.flatMap(g => g.intervals.flat())])].sort((a, b) => a - b);
    for (let i = 1; i < points.length; i++) {
        const s = points[i - 1]!, e = points[i]!;
        if (e <= s)
            continue;
        const key = clipped.find(g => g.intervals.some(([a, b]) => a <= s && b >= e))?.key ?? fallback;
        result[key] += e - s;
    }
    return result;
}
export function subtract(intervals: readonly Interval[], removed: readonly Interval[]): Interval[] {
    return union(intervals).flatMap(([s, e]) => {
        let pieces: Interval[] = [[s, e]];
        for (const [a, b] of union(removed))
            pieces = pieces.flatMap(([x, y]) => b <= x || a >= y ? [[x, y] as Interval] : [...(a > x ? [[x, a] as Interval] : []), ...(b < y ? [[b, y] as Interval] : [])]);
        return pieces;
    });
}
