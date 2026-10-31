import type { FindingDraft, RuleContext } from '../metrics.js';
import { fact } from '../metrics.js';
export function coverageReasons({ snapshot: s }: RuleContext): string[] {
    return [...new Set([...s.input.reasons, ...s.limits, ...s.members.filter(m => !m.detailLoaded).map(m => 'unparsed_member:' + m.id), ...s.members.filter(m => m.provider !== null && m.tokenSemantics === null).map(m => 'unknown_token_semantics:' + m.id), ...(s.spans.length && s.spans.every(x => ['derived', 'unknown', 'unavailable'].includes(x.timing)) ? ['no_observed_timing'] : [])])];
}
export function coverageRules(c: RuleContext): FindingDraft[] { const reasons = coverageReasons(c); return reasons.length ? [fact('cov.incomplete', 'coverage', { reason: reasons.join(', ') }, [], c.snapshot.records.slice(0, 1).map(r => 'evidence:' + r.recordId))] : []; }
