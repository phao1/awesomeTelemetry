import { buildCaptureComparison } from './capture-comparison.js';
import type { CaptureComparisonResponse, CaptureComparisonSide } from './trace-types.js';

export interface CaptureDiagnosticFinding {
  code: 'slow_network' | 'slow_first_content' | 'repeated_encoded_request';
  classification: 'derived';
  evidence: Array<{ side: 'base' | 'target'; requestId: number; path: string; value: string | number }>;
}
export interface CaptureDiagnosticsViewModel {
  thresholdMs: number;
  repeat: 'same_encoded_request' | 'different_encoded_request' | 'unavailable';
  findings: CaptureDiagnosticFinding[];
}

function positiveInteger(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function knownEndpoint(value: string): boolean { return value.trim() !== '' && value.trim().toLowerCase() !== 'unknown'; }
function retainedRequest(side: CaptureComparisonSide): boolean {
  const ref = side.evidence.request;
  return positiveInteger(side.request.id) && side.originalDeletion === null && ref !== null && ref.status === 'complete'
    && positiveInteger(ref.bytes) && /^[a-f0-9]{64}$/.test(ref.sha256);
}
function repeatState(base: CaptureComparisonSide, target: CaptureComparisonSide): CaptureDiagnosticsViewModel['repeat'] {
  if (base.request.id === target.request.id || !retainedRequest(base) || !retainedRequest(target)) return 'unavailable';
  const left = base.request; const right = target.request;
  if (!(['method', 'hostname', 'url'] as const).every(key => knownEndpoint(left[key]) && knownEndpoint(right[key]) && left[key] === right[key])) return 'unavailable';
  if (!['openai_chat', 'openai_responses', 'anthropic_messages'].includes(left.requestFormat) || left.requestFormat !== right.requestFormat) return 'unavailable';
  return base.evidence.request!.bytes === target.evidence.request!.bytes && base.evidence.request!.sha256 === target.evidence.request!.sha256
    ? 'same_encoded_request' : 'different_encoded_request';
}

/** Bounded local evidence leads, never retry, billing, causal or quality conclusions. */
export function deriveCaptureDiagnostics(response: CaptureComparisonResponse, thresholdMs = 10000): CaptureDiagnosticsViewModel {
  const threshold = positiveInteger(thresholdMs) && thresholdMs <= 3600000 ? thresholdMs : 10000;
  const findings: CaptureDiagnosticFinding[] = [];
  const sides = [['base', response.base], ['target', response.target]] as const;
  for (const [name, side] of sides) {
    // Self-pair validation shares comparison's measurement rules without making
    // the other selected record's missing data or differing content basis causal.
    const validated = buildCaptureComparison({ base: side, target: side, generatedAt: response.generatedAt });
    for (const metric of ['completedMs', 'firstContentMs'] as const) {
      const row = validated.timings.find(row => row.id === metric)!;
      if (!row.comparable || row.base === null || row.base < threshold) continue;
      findings.push({ code: metric === 'completedMs' ? 'slow_network' : 'slow_first_content', classification: 'derived',
        evidence: [{ side: name, requestId: side.request.id, path: name + '.evidence.transport.timing.' + metric, value: row.base }] });
    }
  }
  const repeat = repeatState(response.base, response.target);
  if (repeat === 'same_encoded_request') {
    findings.push({ code: 'repeated_encoded_request', classification: 'derived', evidence: sides.flatMap(([name, side]) => [
      { side: name, requestId: side.request.id, path: name + '.evidence.request.sha256', value: side.evidence.request!.sha256 },
      { side: name, requestId: side.request.id, path: name + '.evidence.request.bytes', value: side.evidence.request!.bytes },
    ]) });
  }
  return { thresholdMs: threshold, repeat, findings };
}
