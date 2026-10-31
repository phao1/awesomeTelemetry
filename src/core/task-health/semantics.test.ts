import { expect, it } from 'vitest';
import { timestampSemantics } from './semantics.js';
import { PROVIDER_KEYS } from '../trace-types.js';
it('declares every provider and duration path conservatively', () => { for (const p of PROVIDER_KEYS)
    for (const d of ['measured', 'derived', 'unknown'] as const) {
        const expected = ['claude', 'codex', 'codeagent'].includes(p) ? 'completion' : ['opencode', 'codearts', 'codeagent2'].includes(p) ? d === 'measured' ? 'interval' : 'start' : 'unknown';
        expect(timestampSemantics(p, d)).toBe(expected);
    } expect(timestampSemantics(null, 'unknown')).toBe('interval'); });
