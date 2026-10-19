/**
 * Request-context diff service (add-request-context-diff).
 *
 * T05 scope (§5.8-§5.9): orchestrates the exact two-row, never-raw read,
 * automatic/manual pairing, staged event-loop yields, normalization, bounded
 * diff, and privacy-safe error mapping. It never registers a route (that is
 * T06) and never imports or runs on the proxy forwarding path.
 */

import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { Database } from 'better-sqlite3';

import type {
  CaptureMethod,
  CaptureBodyRef,
  ContextPairingConfidence,
  ContextRequestRef,
  RequestContextDiffResponse,
  RequestContextFormat,
} from '../../src/core/trace-types.js';

import { cachedStmt } from '../storage/stmt-cache.js';
import type { CaptureBodyStore } from './body-store.js';
import { readCaptureBodies } from './capture-storage.js';
import { getOriginalDeletionForProxy } from './original-deletions.js';
import { readAnalysisBody, type AnalysisSourceReason } from './analysis-source.js';
import type { ProxyPredecessor } from '../storage/query-engine.js';
import { findLinkedCapturePredecessor, getUniqueLinkedSession } from '../storage/trace-links.js';
import { diffContexts, enforceResponseBudget } from './context-diff.js';
import {
  normalizeRequestContext,
  type NormalizeErrorReason,
} from './context-normalizer.js';

// ── safe two-row read (never selects raw columns; NFR-P5 / 禁令 2) ───────────

/** Same safe column set as the storage predecessor query, minus raw columns. */
const PROXY_DIFF_ROW_COLS = [
  'id', 'request_id', 'started_at', 'hostname', 'model', 'capture_method',
  'parser_route', 'request_format', 'parsed_session_id', 'capture_group_id',
  'input_tokens', 'request_body',
].join(', ');

const PROXY_DIFF_ROW_SQL =
  `SELECT ${PROXY_DIFF_ROW_COLS} FROM proxy_requests WHERE id = ?`;

function mapDiffRow(row: Record<string, unknown>): ProxyPredecessor {
  return {
    id: row.id as number,
    requestId: row.request_id as string,
    startedAt: row.started_at as string,
    hostname: row.hostname as string,
    model: row.model as string | null,
    captureMethod: row.capture_method as CaptureMethod,
    parserRoute: row.parser_route as string | null,
    requestFormat: row.request_format as RequestContextFormat,
    parsedSessionId: row.parsed_session_id as string | null,
    captureGroupId: row.capture_group_id as string | null,
    inputTokens: row.input_tokens as number | null,
    requestBody: row.request_body as string | null,
  };
}

function readDiffRow(db: Database, id: number): ProxyPredecessor | null {
  const row = cachedStmt(db, PROXY_DIFF_ROW_SQL).get(id) as
    | Record<string, unknown>
    | undefined;
  return row === undefined ? null : mapDiffRow(row);
}

// ── pairing ──────────────────────────────────────────────────────────────────

interface AutomaticBase {
  row: ProxyPredecessor;
  confidence: ContextPairingConfidence;
  reason: string;
  warnings: string[];
}

/**
 * fuse-agent-monitoring: unique evidence-backed session membership first.
 * Capture order is not a claim of immediately adjacent native model calls.
 */
function selectAutomaticBase(
  db: Database,
  target: ProxyPredecessor,
  targetId: number,
): AutomaticBase | null {
  const previous = findLinkedCapturePredecessor(db, { id: targetId, requestFormat: target.requestFormat, startedAt: target.startedAt });
  if (previous === null) return null;
  const row = readDiffRow(db, previous.id);
  if (row === null) return null;
  return { row, confidence: 'linked_session',
    reason: 'nearest earlier eligible capture in linked session ' + previous.sessionKey,
    warnings: ['linked membership and capture order do not prove the immediately previous native model call', ...manualWarnings(row, target)] };
}

/** Manual pairing discloses identity mismatches instead of rejecting them. */
function manualWarnings(base: ProxyPredecessor, target: ProxyPredecessor): string[] {
  const warnings: string[] = [];
  if (
    base.parsedSessionId !== null &&
    target.parsedSessionId !== null &&
    base.parsedSessionId !== target.parsedSessionId
  ) {
    warnings.push('parsed session identifiers differ');
  }
  if (
    base.captureGroupId !== null &&
    target.captureGroupId !== null &&
    base.captureGroupId !== target.captureGroupId
  ) {
    warnings.push('capture groups differ');
  }
  if (base.requestFormat !== target.requestFormat) {
    warnings.push(`request formats differ (${base.requestFormat} vs ${target.requestFormat})`);
  }
  if (base.model !== target.model) {
    warnings.push('models differ');
  }
  return warnings;
}

// ── provenance ref ───────────────────────────────────────────────────────────

function toRequestRef(row: ProxyPredecessor, original?: CaptureBodyRef): ContextRequestRef {
  const body = row.requestBody ?? '';
  return {
    id: row.id,
    requestId: row.requestId,
    startedAt: row.startedAt,
    hostname: row.hostname,
    model: row.model,
    captureMethod: row.captureMethod,
    parserRoute: row.parserRoute,
    requestFormat: row.requestFormat as Exclude<RequestContextFormat, 'unknown'>,
    parsedSessionId: row.parsedSessionId,
    captureGroupId: row.captureGroupId,
    bodySha256: original?.sha256 ?? createHash('sha256').update(body, 'utf8').digest('hex'),
    bodyBytes: original?.bytes ?? Buffer.byteLength(body, 'utf8'),
  };
}

// ── stable internal errors (task 5.9; never body/header/stack) ───────────────

export type ContextDiffErrorCode =
  | 'BAD_REQUEST'
  | 'PROXY_REQUEST_NOT_FOUND'
  | 'CONTEXT_DIFF_UNAVAILABLE'
  | 'CONTEXT_DIFF_UNSUPPORTED'
  | 'INTERNAL_ERROR';

export class ContextDiffServiceError extends Error {
  readonly code: ContextDiffErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ContextDiffErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ContextDiffServiceError';
    this.code = code;
    this.details = details;
  }
}

export interface ContextDiffServiceInput {
  targetId: number;
  /** Omitted/`previous` means automatic; a positive integer means manual. */
  base: 'previous' | number;
}

export type ContextDiffServiceResult =
  | { ok: true; value: RequestContextDiffResponse }
  | { ok: false; error: ContextDiffServiceError };

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function unsupported(role: 'base' | 'target', reason: NormalizeErrorReason | AnalysisSourceReason): ContextDiffServiceError {
  return new ContextDiffServiceError(
    'CONTEXT_DIFF_UNSUPPORTED',
    `${role} source cannot be normalized safely within phase-1 rules`,
    { role, reason },
  );
}

/**
 * design D12 staged service flow: validate -> read two rows -> normalize base
 * -> yield -> normalize target -> yield -> diff (yields internally) -> build
 * bounded response. Exactly one target and at most one base body are read, and
 * raw columns are never selected.
 */
export async function runContextDiff(
  db: Database,
  input: ContextDiffServiceInput,
  getBodyStore?: () => Promise<CaptureBodyStore>,
): Promise<ContextDiffServiceResult> {
  const started = performance.now();
  try {
    const { targetId, base } = input;
    if (!Number.isInteger(targetId) || targetId <= 0) {
      throw new ContextDiffServiceError('BAD_REQUEST', 'invalid target request id', { role: 'target' });
    }
    if (base !== 'previous' && (!Number.isInteger(base) || base <= 0)) {
      throw new ContextDiffServiceError('BAD_REQUEST', 'base must be "previous" or a positive integer', { role: 'base' });
    }
    if (base !== 'previous' && base === targetId) {
      throw new ContextDiffServiceError('BAD_REQUEST', 'base and target must be different requests', {});
    }

    const targetRow = readDiffRow(db, targetId);
    if (targetRow === null) {
      throw new ContextDiffServiceError('PROXY_REQUEST_NOT_FOUND', 'target request not found', { role: 'target' });
    }
    if (getOriginalDeletionForProxy(db, targetId) !== null) throw unsupported('target', 'original_deleted');

    let baseRow: ProxyPredecessor;
    let confidence: ContextPairingConfidence;
    let reason: string;
    let warnings: string[];

    if (base === 'previous') {
      const automatic = selectAutomaticBase(db, targetRow, targetId);
      if (automatic === null) {
        throw new ContextDiffServiceError(
          'CONTEXT_DIFF_UNAVAILABLE',
          'no trustworthy automatic predecessor',
          { reason: 'pairing_unavailable' },
        );
      }
      baseRow = automatic.row;
      confidence = automatic.confidence;
      reason = automatic.reason;
      warnings = automatic.warnings;
    } else {
      const manualRow = readDiffRow(db, base);
      if (manualRow === null) {
        throw new ContextDiffServiceError('PROXY_REQUEST_NOT_FOUND', 'base request not found', { role: 'base' });
      }
      baseRow = manualRow;
      confidence = 'manual';
      reason = 'manual';
      warnings = manualWarnings(baseRow, targetRow);
      const baseSession = getUniqueLinkedSession(db, baseRow.id);
      const targetSession = getUniqueLinkedSession(db, targetRow.id);
      if (baseSession === null || targetSession === null) warnings.push('one or both requests lack unambiguous linked session membership');
      else if (baseSession !== targetSession) warnings.push('linked session memberships differ');
    }

    const originals = new Map<number, CaptureBodyRef>();
    const resolveOriginal = async (row: ProxyPredecessor, role: 'base' | 'target'): Promise<ProxyPredecessor> => {
      if (getOriginalDeletionForProxy(db, row.id) !== null) throw unsupported(role, 'original_deleted');
      const capture = readCaptureBodies(db, row.id);
      const ref = capture.request;
      if (ref === null) return row; // historical records have no file references
      if (getBodyStore === undefined) throw unsupported(role, 'source_unavailable');
      const source = await readAnalysisBody(await getBodyStore(), ref, 2 * 1024 * 1024, { contentEncoding: capture.processing?.contentDecoding?.request });
      if (!source.ok) throw unsupported(role, source.reason);
      originals.set(row.id, ref);
      return { ...row, requestBody: source.body };
    };
    baseRow = await resolveOriginal(baseRow, 'base');
    const targetSourceRow = await resolveOriginal(targetRow, 'target');
    const baseNorm = normalizeRequestContext({
      format: baseRow.requestFormat,
      desensitizedBody: baseRow.requestBody ?? '',
    });
    if (!baseNorm.ok) {
      throw unsupported('base', baseNorm.reason);
    }
    await yieldTurn();

    const targetNorm = normalizeRequestContext({
      format: targetRow.requestFormat,
      desensitizedBody: targetSourceRow.requestBody ?? '',
    });
    if (!targetNorm.ok) {
      throw unsupported('target', targetNorm.reason);
    }
    await yieldTurn();

    const diff = await diffContexts({
      base: baseNorm.normalized,
      target: targetNorm.normalized,
      baseInputTokens: baseRow.inputTokens,
      targetInputTokens: targetRow.inputTokens,
    });

    const response: RequestContextDiffResponse = {
      base: toRequestRef(baseRow, originals.get(baseRow.id)),
      target: toRequestRef(targetSourceRow, originals.get(targetSourceRow.id)),
      pairing: { confidence, reason, warnings },
      noChange: diff.noChange,
      growth: diff.growth,
      indicators: diff.indicators,
      categories: diff.categories,
      completeness: diff.completeness,
      generatedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
    };
    enforceResponseBudget(response);
    if (getOriginalDeletionForProxy(db, baseRow.id) !== null) throw unsupported('base', 'original_deleted');
    if (getOriginalDeletionForProxy(db, targetRow.id) !== null) throw unsupported('target', 'original_deleted');
    return { ok: true, value: response };
  } catch (err) {
    if (err instanceof ContextDiffServiceError) {
      return { ok: false, error: err };
    }
    return {
      ok: false,
      error: new ContextDiffServiceError('INTERNAL_ERROR', 'internal error computing context diff', {}),
    };
  }
}
