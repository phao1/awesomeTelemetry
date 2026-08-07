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
  ContextPairingConfidence,
  ContextRequestRef,
  RequestContextDiffResponse,
  RequestContextFormat,
} from '../../src/core/trace-types.js';

import { cachedStmt } from '../storage/stmt-cache.js';
import {
  findCaptureGroupPredecessor,
  findExactSessionPredecessor,
  type ProxyPredecessor,
} from '../storage/query-engine.js';
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
}

/**
 * design D4: exact parsed-session predecessor first, then capture-group
 * predecessor under null-safe model equality, rejecting conflicting known
 * session IDs. Unknown-format targets have no trustworthy predecessor.
 */
function selectAutomaticBase(
  db: Database,
  target: ProxyPredecessor,
  targetId: number,
): AutomaticBase | null {
  if (target.requestFormat !== 'unknown') {
    if (target.parsedSessionId !== null) {
      const p = findExactSessionPredecessor(
        db,
        target.parsedSessionId,
        target.requestFormat,
        targetId,
      );
      if (p !== null) {
        return { row: p, confidence: 'exact', reason: 'nearest earlier same parsed session and format' };
      }
    }
    if (target.captureGroupId !== null) {
      const p = findCaptureGroupPredecessor(
        db,
        target.captureGroupId,
        target.requestFormat,
        target.model,
        targetId,
      );
      if (p !== null) {
        if (
          target.parsedSessionId !== null &&
          p.parsedSessionId !== null &&
          target.parsedSessionId !== p.parsedSessionId
        ) {
          return null; // conflicting known sessions: do not pair automatically.
        }
        return { row: p, confidence: 'capture_group', reason: 'nearest earlier same capture group, format and model' };
      }
    }
  }
  return null;
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

function toRequestRef(row: ProxyPredecessor): ContextRequestRef {
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
    bodySha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    bodyBytes: Buffer.byteLength(body, 'utf8'),
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

function unsupported(role: 'base' | 'target', reason: NormalizeErrorReason): ContextDiffServiceError {
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
      warnings = [];
    } else {
      const manualRow = readDiffRow(db, base);
      if (manualRow === null) {
        throw new ContextDiffServiceError('PROXY_REQUEST_NOT_FOUND', 'base request not found', { role: 'base' });
      }
      baseRow = manualRow;
      confidence = 'manual';
      reason = 'manual';
      warnings = manualWarnings(baseRow, targetRow);
    }

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
      desensitizedBody: targetRow.requestBody ?? '',
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
      base: toRequestRef(baseRow),
      target: toRequestRef(targetRow),
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
