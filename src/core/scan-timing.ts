import type { TraceSession } from './trace-types.js';

export interface ScanTimingSide { session: TraceSession; pending?: boolean; hasMore?: boolean; eventOffset?: number }
export type ScanTimingMetric = 'e2e' | 'ttft' | 'tps' | 'tpot' | 'turnGap' | 'eventDuration';
export type ScanTimingReason = 'missing_value' | 'invalid_value' | 'source_mismatch' | 'duration_basis_mismatch' | 'duration_basis_unknown' | 'partial_evidence';

/** Preserve zero and fractional legacy values; never convert unknown into zero. */
export function scanTimingValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
/** Policy only: no metric recomputation, provider hardcoded inference or new provenance. */
export function scanTimingReason(left: ScanTimingSide | null | undefined, right: ScanTimingSide | null | undefined,
  metric: ScanTimingMetric, lv: number | null | undefined, rv: number | null | undefined): ScanTimingReason | null {
  if (lv == null || rv == null) return 'missing_value';
  if (scanTimingValue(lv) === null || scanTimingValue(rv) === null || metric === 'e2e' && (lv === 0 || rv === 0)) return 'invalid_value';
  if (left == null || right == null || left.session.dataSource !== 'scan' || right.session.dataSource !== 'scan') return 'source_mismatch';
  if (left.pending === true || right.pending === true) return 'partial_evidence';
  // Session wall-clock is independent of event-duration declarations/pages.
  if (metric === 'e2e') return null;
  if (left.hasMore === true || right.hasMore === true || (left.eventOffset ?? 0) !== 0 || (right.eventOffset ?? 0) !== 0) return 'partial_evidence';
  if (left.session.provider !== right.session.provider || left.session.sourceAgent !== right.session.sourceAgent || !left.session.sourceAgent.trim()) return 'source_mismatch';
  const known = (value: unknown): boolean => value === 'measured' || value === 'derived';
  if (!known(left.session.durationSource) || !known(right.session.durationSource)) return 'duration_basis_unknown';
  return left.session.durationSource === right.session.durationSource ? null : 'duration_basis_mismatch';
}
/** Descriptive max/min observation ratio, never a model/Agent improvement claim. */
export function scanTimingRatio(left: ScanTimingSide | null | undefined, right: ScanTimingSide | null | undefined,
  metric: ScanTimingMetric, lv: number | null | undefined, rv: number | null | undefined): number | null {
  if (scanTimingReason(left, right, metric, lv, rv) !== null || lv == null || rv == null || lv <= 0 || rv <= 0) return null;
  const ratio = Math.max(lv, rv) / Math.min(lv, rv);
  return Number.isFinite(ratio) ? ratio : null;
}
