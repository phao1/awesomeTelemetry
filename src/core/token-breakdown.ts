import type { TokenUsage, TraceRecord } from './trace-types.js';
import { aggregateTokenUsage } from '../adapters/helpers.js';

/** REQ-007：token 分解（input / output / reasoning / cacheRead / cacheWrite）。 */
export function computeTokenBreakdown(record: TraceRecord): TokenUsage {
  return aggregateTokenUsage(record.events, record.tokenSemantics);
}

/** REQ-007：可读文本。 */
export function extractTokenText(tokens: TokenUsage | null): string {
  if (tokens === null) {
    return 'tokens: n/a';
  }
  return [
    `input ${tokens.input}`,
    `output ${tokens.output}`,
    `reasoning ${tokens.reasoning}`,
    `cacheRead ${tokens.cacheRead}`,
    `cacheWrite ${tokens.cacheWrite}`,
    `total ${tokens.total}`,
  ].join(' · ');
}
