import type { CaptureComparisonAnalysis, CaptureComparisonResponse, CaptureComparisonSide, CaptureNetworkTiming } from './trace-types.js';

export type CaptureComparisonReason = 'missing_value' | 'invalid_value' | 'clock_unavailable' | 'clock_mismatch' | 'incomplete_evidence'
  | 'content_not_observed' | 'content_basis_mismatch' | 'content_kind_mismatch' | 'analysis_unavailable' | 'accounting_unknown' | 'accounting_mismatch' | 'original_deleted' | 'protocol_not_completed';
export type CaptureComparisonWarningCode = 'model_mismatch' | 'model_unknown' | 'protocol_mismatch' | 'protocol_unknown' | 'accounting_mismatch' | 'accounting_unknown'
  | 'processing_mismatch' | 'processing_unknown' | 'processing_incomplete' | 'retention_mismatch' | 'retention_unknown' | 'retention_incomplete'
  | 'analysis_mismatch' | 'analysis_incomplete' | 'analysis_unavailable' | 'completeness_mismatch' | 'measurement_mismatch' | 'timing_unavailable' | 'timing_incomplete'
  | 'original_deleted' | 'task_tool_parameters_quality_unproven' | 'natural_comparison_not_causal' | 'cost_unknown';

const TIMING_IDS = ['responseHeadersMs', 'firstBodyByteMs', 'firstContentMs', 'completedMs'] as const;
const USAGE_IDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'nativeTotalTokens', 'totalTokens'] as const;
export type CaptureTimingMetricId = typeof TIMING_IDS[number];
export type CaptureUsageMetricId = typeof USAGE_IDS[number];
export interface CaptureComparisonMetricRow {
  id: CaptureTimingMetricId | CaptureUsageMetricId;
  unit: 'ms' | 'tokens';
  base: number | null;
  target: number | null;
  delta: number | null;
  comparable: boolean;
  reasons: CaptureComparisonReason[];
  baseSource: string;
  targetSource: string;
}
type SideName = 'base' | 'target';
export interface CaptureComparisonWarning { code: CaptureComparisonWarningCode; sides: SideName[]; details: string[] }
export interface CaptureComparisonViewModel {
  timings: CaptureComparisonMetricRow[];
  usage: CaptureComparisonMetricRow[];
  warnings: CaptureComparisonWarning[];
  cost: { base: null; target: null; delta: null; reason: 'not_estimated' };
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function valueReasons(base: unknown, target: unknown): CaptureComparisonReason[] {
  const reasons: CaptureComparisonReason[] = [];
  if (base === null || base === undefined || target === null || target === undefined) reasons.push('missing_value');
  if ((base != null && number(base) === null) || (target != null && number(target) === null)) reasons.push('invalid_value');
  return reasons;
}
function analysis(side: CaptureComparisonSide): CaptureComparisonAnalysis | null {
  return side.originalDeletion !== null || side.analysisUnavailableReason !== null ? null : side.analysis;
}
function knownAccounting(value: unknown): boolean { return value === 'openai_subsets' || value === 'anthropic_additive_input'; }
function timing(side: CaptureComparisonSide): CaptureNetworkTiming | undefined { return side.evidence.transport?.timing; }
function transportComplete(side: CaptureComparisonSide): boolean {
  const value = side.evidence.transport;
  // A normally ended HTTP error is still a complete network measurement, not Agent success.
  return value !== undefined && value.version === 1 && (value.state === 'completed' || value.state === 'http_error') && value.requestEnded === true && value.responseEnded === true;
}
function timingOrdered(value: CaptureNetworkTiming | undefined): boolean {
  if (value === undefined) return true;
  const known = TIMING_IDS.map(id => number(value[id])).filter((value): value is number => value !== null);
  return known.every((value, index) => index === 0 || known[index - 1]! <= value);
}
function timingReasons(base: CaptureComparisonSide, target: CaptureComparisonSide): CaptureComparisonReason[] {
  const reasons: CaptureComparisonReason[] = [];
  if (timing(base)?.clock == null || timing(target)?.clock == null) reasons.push('clock_unavailable');
  if ((timing(base)?.clock != null && timing(base)!.clock !== 'proxy_monotonic') || (timing(target)?.clock != null && timing(target)!.clock !== 'proxy_monotonic')) reasons.push('clock_mismatch');
  if (!transportComplete(base) || !transportComplete(target)) reasons.push('incomplete_evidence');
  if ((timing(base) !== undefined && timing(base)!.version !== 1) || (timing(target) !== undefined && timing(target)!.version !== 1)) reasons.push('invalid_value');
  if (!timingOrdered(timing(base)) || !timingOrdered(timing(target))) reasons.push('invalid_value');
  return reasons;
}
function contentReasons(base: CaptureComparisonSide, target: CaptureComparisonSide): CaptureComparisonReason[] {
  const left = timing(base); const right = timing(target); const reasons: CaptureComparisonReason[] = [];
  if (left?.contentTimingStatus !== 'observed' || right?.contentTimingStatus !== 'observed') reasons.push('content_not_observed');
  if (left?.firstContentBasis == null || right?.firstContentBasis == null || left.firstContentBasis !== right.firstContentBasis
    || !['sse_event_dispatch', 'json_document_complete'].includes(left.firstContentBasis)) reasons.push('content_basis_mismatch');
  if (left?.firstContentKind == null || right?.firstContentKind == null || left.firstContentKind !== right.firstContentKind
    || !['text', 'reasoning', 'tool_arguments'].includes(left.firstContentKind)) reasons.push('content_kind_mismatch');
  return reasons;
}
function usageReasons(base: CaptureComparisonSide, target: CaptureComparisonSide): CaptureComparisonReason[] {
  const left = analysis(base); const right = analysis(target); const reasons: CaptureComparisonReason[] = [];
  if (base.originalDeletion !== null || target.originalDeletion !== null) reasons.push('original_deleted');
  if (left === null || right === null) reasons.push('analysis_unavailable');
  if ((left !== null && !left.completeness.complete) || (right !== null && !right.completeness.complete)) reasons.push('incomplete_evidence');
  if ((left !== null && left.state !== 'completed') || (right !== null && right.state !== 'completed')) reasons.push('protocol_not_completed');
  if (!knownAccounting(left?.usage.accounting) || !knownAccounting(right?.usage.accounting)) reasons.push('accounting_unknown');
  else if (left !== null && right !== null && left.usage.accounting !== right.usage.accounting) reasons.push('accounting_mismatch');
  return reasons;
}
function row(id: CaptureComparisonMetricRow['id'], unit: CaptureComparisonMetricRow['unit'], left: unknown, right: unknown,
  reasons: CaptureComparisonReason[], path: string): CaptureComparisonMetricRow {
  const base = number(left); const target = number(right);
  const uniqueReasons = [...new Set([...reasons, ...valueReasons(left, right)])];
  const comparable = uniqueReasons.length === 0 && base !== null && target !== null;
  return { id, unit, base, target, delta: comparable ? target! - base! : null, comparable, reasons: uniqueReasons,
    baseSource: 'base.' + path + '.' + id, targetSource: 'target.' + path + '.' + id };
}
function retention(side: CaptureComparisonSide): string {
  return [side.evidence.request?.status ?? 'unknown', side.evidence.response?.status ?? 'unknown', side.originalDeletion?.state ?? 'no_intent'].join('/');
}
function completeness(side: CaptureComparisonSide): string {
  const value = analysis(side);
  return JSON.stringify([value?.completeness ?? null, value?.errorCodesTruncated ?? null, side.evidence.requestPreviewTruncated, side.evidence.responsePreviewTruncated,
    side.evidence.request?.status ?? null, side.evidence.response?.status ?? null, side.evidence.transport?.requestEnded ?? null, side.evidence.transport?.responseEnded ?? null]);
}

/** Descriptive differences only: no IO, hidden fallback counters, cost estimate or causal verdict. */
export function buildCaptureComparison(response: CaptureComparisonResponse): CaptureComparisonViewModel {
  const { base, target } = response;
  const warnings = new Map<CaptureComparisonWarningCode, CaptureComparisonWarning>();
  const warn = (code: CaptureComparisonWarningCode, sides: SideName[], details: string[]): void => {
    const existing = warnings.get(code);
    if (existing === undefined) warnings.set(code, { code, sides: [...sides], details: [...details] });
    else { existing.sides = [...new Set([...existing.sides, ...sides])]; existing.details = [...new Set([...existing.details, ...details])]; }
  };
  const pairs: Array<[SideName, CaptureComparisonSide]> = [['base', base], ['target', target]];
  for (const [name, side] of pairs) {
    const value = analysis(side); const processing = side.evidence.processing;
    const model = value?.model ?? side.request.model;
    const protocol = value?.requestFormat ?? side.request.requestFormat;
    if (model === null || model === '') warn('model_unknown', [name], [name + ':model=null']);
    if (protocol === 'unknown') warn('protocol_unknown', [name], [name + ':requestFormat=unknown']);
    if (value === null) warn('analysis_unavailable', [name], [name + ':' + (side.originalDeletion !== null ? 'original_deleted' : side.analysisUnavailableReason ?? 'analysis_unavailable')]);
    else if (!value.completeness.complete) warn('analysis_incomplete', [name], [name + ':state=' + value.state, ...value.completeness.reasons.map(reason => name + ':' + reason)]);
    if (!knownAccounting(value?.usage.accounting)) warn('accounting_unknown', [name], [name + ':accounting=' + (value?.usage.accounting ?? 'unavailable')]);
    if (processing === undefined) warn('processing_unknown', [name], [name + ':processing=unavailable']);
    else if (processing.status !== 'ok') warn('processing_incomplete', [name], [name + ':processing=' + processing.status]);
    if (side.evidence.request === null || side.evidence.response === null) warn('retention_unknown', [name], [name + ':' + retention(side)]);
    if ([side.evidence.request, side.evidence.response].some(ref => ref !== null && ref.status !== 'complete')) warn('retention_incomplete', [name], [name + ':' + retention(side)]);
    if (side.originalDeletion !== null) warn('original_deleted', [name], [name + ':intent=' + side.originalDeletion.state]);
    if (timing(side) === undefined) warn('timing_unavailable', [name], [name + ':timing=unavailable']);
    if (!transportComplete(side)) warn('timing_incomplete', [name], [name + ':transport=' + (side.evidence.transport?.state ?? 'unknown')]);
  }
  const left = analysis(base); const right = analysis(target);
  const leftModel = left?.model ?? base.request.model; const rightModel = right?.model ?? target.request.model;
  if (leftModel !== null && rightModel !== null && leftModel !== rightModel) warn('model_mismatch', ['base', 'target'], ['base:' + leftModel, 'target:' + rightModel]);
  const leftProtocol = left?.requestFormat ?? base.request.requestFormat; const rightProtocol = right?.requestFormat ?? target.request.requestFormat;
  if (leftProtocol !== rightProtocol) warn('protocol_mismatch', ['base', 'target'], ['base:' + leftProtocol, 'target:' + rightProtocol]);
  if (left !== null && right !== null && left.usage.accounting !== right.usage.accounting) warn('accounting_mismatch', ['base', 'target'], ['base:' + left.usage.accounting, 'target:' + right.usage.accounting]);
  if (base.evidence.processing?.status !== target.evidence.processing?.status) warn('processing_mismatch', ['base', 'target'], ['base:' + (base.evidence.processing?.status ?? 'unknown'), 'target:' + (target.evidence.processing?.status ?? 'unknown')]);
  if (retention(base) !== retention(target)) warn('retention_mismatch', ['base', 'target'], ['base:' + retention(base), 'target:' + retention(target)]);
  if (left !== null && right !== null && (left.parserVersion !== right.parserVersion || left.state !== right.state)) warn('analysis_mismatch', ['base', 'target'], ['base:parser=' + left.parserVersion + '/state=' + left.state, 'target:parser=' + right.parserVersion + '/state=' + right.state]);
  if (completeness(base) !== completeness(target)) warn('completeness_mismatch', ['base', 'target'], ['base:' + completeness(base), 'target:' + completeness(target)]);
  const networkReasons = timingReasons(base, target);
  const firstContentReasons = contentReasons(base, target);
  if (networkReasons.length > 0 || firstContentReasons.length > 0) warn('measurement_mismatch', ['base', 'target'], [...networkReasons, ...firstContentReasons]);
  const timings = TIMING_IDS.map(id => row(id, 'ms', timing(base)?.[id], timing(target)?.[id],
    id === 'firstContentMs' ? [...networkReasons, ...firstContentReasons] : networkReasons, 'evidence.transport.timing'));
  if (timings.some(value => value.reasons.includes('invalid_value'))) warn('measurement_mismatch', ['base', 'target'], ['invalid_value']);
  const commonUsageReasons = usageReasons(base, target);
  const usage = USAGE_IDS.map(id => row(id, 'tokens', left?.usage[id], right?.usage[id], commonUsageReasons, 'analysis.usage'));
  warn('task_tool_parameters_quality_unproven', ['base', 'target'], ['task/tool/parameter/result quality equivalence is not established by capture metadata']);
  warn('natural_comparison_not_causal', ['base', 'target'], ['observed target-minus-base differences are not a controlled experiment, speedup, retry or charge identity']);
  warn('cost_unknown', ['base', 'target'], ['cost not estimated; missing price/billing identity is not free']);
  return { timings, usage, warnings: [...warnings.values()], cost: { base: null, target: null, delta: null, reason: 'not_estimated' } };
}
