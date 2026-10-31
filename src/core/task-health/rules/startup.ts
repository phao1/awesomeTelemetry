import type { FindingDraft, RuleContext } from '../metrics.js';
/** Startup has facts only; the contract defines no startup optimization rule. */
export function startupRules(_context: RuleContext): FindingDraft[] { return []; }
