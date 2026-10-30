import type { HealthThresholds } from './types.js';
export const DEFAULT_HEALTH_THRESHOLDS: Readonly<HealthThresholds> = Object.freeze({
    profile: 'codearts-perf-v1', longToolMs: 100000, duplicateInstalls: 2, toolErrorPct: 30, toolErrorMinCalls: 3, consecutiveErrors: 3,
    writeFiles: 5, singleFileWriteRoundPct: 70, serialReads: 3, roundBaseline: null, roundMultiplier: 1.5, explorePct: 40, repeatedReads: 3, reworkRounds: 2,
    firstOutputMs: 5000, reasoningMinRounds: 10, reasoningPct: 90, reasoningGroupMin: 3, reasoningRatio: 2, cacheHitPct: 90, gapMs: 60000,
});
const counts = new Set(['duplicateInstalls', 'toolErrorMinCalls', 'consecutiveErrors', 'writeFiles', 'serialReads', 'roundBaseline', 'repeatedReads', 'reworkRounds', 'reasoningMinRounds', 'reasoningGroupMin']);
const ratios = new Set(['roundMultiplier', 'reasoningRatio']);
export function validateHealthThresholds(value?: Partial<HealthThresholds>): HealthThresholds {
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))))
        throw new TypeError('Health thresholds must be a plain object');
    const result = { ...DEFAULT_HEALTH_THRESHOLDS };
    for (const [key, v] of Object.entries(value ?? {})) {
        if (!Object.hasOwn(result, key))
            throw new TypeError(`Unknown health threshold: ${key}`);
        if (key === 'profile') {
            if (v !== 'codearts-perf-v1')
                throw new RangeError('Invalid profile');
            continue;
        }
        if (key === 'roundBaseline' && v === null) {
            result.roundBaseline = null;
            continue;
        }
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (/Pct$/.test(key) && v > 100) || counts.has(key) && (!Number.isSafeInteger(v) || v < 1) || ratios.has(key) && v <= 0)
            throw new RangeError(`Invalid health threshold: ${key}`);
        Object.assign(result, { [key]: v });
    }
    return result;
}
