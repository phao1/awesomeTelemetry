import { expect, it } from 'vitest';
import { DEFAULT_HEALTH_THRESHOLDS, validateHealthThresholds } from './thresholds.js';
it('resolves a fresh versioned default and overrides', () => { expect(validateHealthThresholds()).toEqual(DEFAULT_HEALTH_THRESHOLDS); expect(validateHealthThresholds({ longToolMs: 0, roundBaseline: null, cacheHitPct: 100 })).toMatchObject({ longToolMs: 0, roundBaseline: null, cacheHitPct: 100 }); });
it('rejects malformed, unknown and out-of-range overrides', () => { for (const value of [null, [], { x: 1 }, { profile: 'x' }, { gapMs: NaN }, { longToolMs: Infinity }, { cacheHitPct: 101 }, { serialReads: 0 }, { writeFiles: 1.5 }, { roundMultiplier: 0 }, { gapMs: null }])
    expect(() => validateHealthThresholds(value as never)).toThrow(); });
