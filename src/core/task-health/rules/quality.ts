import type { FindingDraft, RuleContext } from '../metrics.js';
import { fact, metric, scopePartial } from '../metrics.js';
export function qualityRules(c: RuleContext): FindingDraft[] {
    const { snapshot: s } = c, out: FindingDraft[] = [];
    if (!s.input.running && ['error', 'cancelled'].includes(s.input.recordedStatus))
        out.push(fact('quality.error_end', 'quality', { status: s.input.recordedStatus }, [], s.records.slice(-1).map(r => 'evidence:' + r.recordId)));
    if (!s.input.running && !scopePartial(s) && metric(c, 'ux.first_write_log')?.value != null && metric(c, 'ux.first_verified_log')?.value == null)
        out.push(fact('quality.unverified', 'quality', {}, s.tools.filter(t => t.span.toolClass === 'write/edit')));
    return out;
}
