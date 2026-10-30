import type { FindingDraft, RuleContext } from '../metrics.js';
import { fact, metric } from '../metrics.js';
export function perceivedRules(c: RuleContext): FindingDraft[] { const m = metric(c, 'ux.max_gap_log'); return m?.value != null && m.value > c.thresholds.gapMs ? [fact('perceived.long_gap', 'perceived', { gap: m.value, cause: m.facets.cause ?? 'unattributed' }, [], m.evidenceIds, m.facets.startMs !== undefined ? [[Number(m.facets.startMs), Number(m.facets.endMs)]] : [])] : []; }
