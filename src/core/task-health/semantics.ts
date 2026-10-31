import type { DurationSource, ProviderKey } from '../trace-types.js';
import type { TimestampSemantics } from './types.js';
/** Session declaration only; individual native endpoints must still be verified. */
export function timestampSemantics(provider: ProviderKey | null, durationSource: DurationSource): TimestampSemantics {
    if (provider === null)
        return 'interval';
    if (['codex', 'claude', 'codeagent'].includes(provider))
        return 'completion';
    if (['opencode', 'codearts', 'codeagent2'].includes(provider))
        return durationSource === 'measured' ? 'interval' : 'start';
    return 'unknown';
}
