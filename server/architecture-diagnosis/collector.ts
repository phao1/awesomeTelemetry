import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { ArchitectureDiagnosisInput, ArchitectureEvidence } from '../../src/core/architecture-diagnosis-types.js';
import type { ProxyProtocolAnalysis } from '../../src/core/trace-types.js';
import type { CodexDiagnosisBatch } from '../codex/projector.js';
import { getTask, recordMembers, taskRecords } from '../storage/task-workbench.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { extractNativeFacts, linkNativeHandoffs, type EvidenceWriter, type NativeBody, type NativeTarget } from './native.js';
import { extractCaptureFacts, pairCaptureResults, type CaptureResult } from './capture.js';

export interface ArchitectureCaptureSource { analysis: ProxyProtocolAnalysis; requestBody: string | null; fingerprint: string; requestComplete: boolean }
export interface ArchitectureCollectorDependencies {
  db: Database;
  loadCapture: (id: number, signal: AbortSignal) => Promise<ArchitectureCaptureSource>;
  loadCodex?: (id: number, signal: AbortSignal) => Promise<CodexDiagnosisBatch>;
}
export class ArchitectureDiagnosisError extends Error {
  readonly reason: 'BUSY' | 'CANCELLED' | 'SOURCE_CHANGED' | 'LIMIT';
  readonly status: number;
  constructor(reason: ArchitectureDiagnosisError['reason'], status = 409) { super(reason); this.reason = reason; this.status = status; }
}
interface CaptureRow { id: number; request_id: string; method: string; hostname: string; request_format: string; model: string | null; started_at: string; scope: string }
interface BodyRow { session_id: string; id: string; sequence: number; status: string; raw: Buffer | null; input: Buffer | null; output: Buffer | null; raw_len: number | null; input_len: number; output_len: number }
const CAPTURES_SQL = `SELECT p.id,p.request_id,p.method,p.hostname,p.request_format,p.model,p.started_at,
 (SELECT group_concat(scope.session_key,'|') FROM (SELECT a.session_key FROM trace_associations a WHERE a.proxy_id=p.id AND a.state IN ('direct','confirmed') ORDER BY a.session_key) scope) AS scope
 FROM (SELECT DISTINCT proxy_id FROM trace_associations WHERE state IN ('direct','confirmed') AND session_key IN (SELECT value FROM json_each(?))) chosen
 JOIN proxy_requests p ON p.id=chosen.proxy_id WHERE 1=1
 AND NOT EXISTS(SELECT 1 FROM trace_associations a WHERE a.proxy_id=p.id AND a.state IN ('direct','confirmed') AND a.session_key NOT IN (SELECT value FROM json_each(?)))
 ORDER BY p.started_at,p.id LIMIT 9`;
const BODIES_SQL = `SELECT e.session_id,e.id,e.sequence,e.status,
 substr(CAST(r.raw AS BLOB),1,65536) AS raw,length(CAST(r.raw AS BLOB)) AS raw_len,
 NULL AS input,0 AS input_len,NULL AS output,0 AS output_len
 FROM json_each(?) selected JOIN events e ON e.session_id=json_extract(selected.value,'$[0]') AND e.id=json_extract(selected.value,'$[1]')
 LEFT JOIN event_raw r ON r.session_id=e.session_id AND r.event_id=e.id ORDER BY e.started_at,e.session_id,e.sequence`;
const TARGETS_SQL = `SELECT s.session_key,i.value FROM trace_identity_sources s JOIN trace_identities i ON i.source_id=s.id
 WHERE s.complete=1 AND s.session_key IN (SELECT value FROM json_each(?)) AND i.kind='session' AND i.scope IS NULL AND i.namespace LIKE 'agent:%'
 AND (SELECT COUNT(DISTINCT n.namespace || ':' || n.value) FROM trace_identities n WHERE n.source_id=s.id AND n.kind='session' AND n.scope IS NULL AND n.namespace LIKE 'agent:%')=1
 AND NOT EXISTS(SELECT 1 FROM trace_identities other INDEXED BY idx_trace_identities_native JOIN trace_identity_sources owner ON owner.id=other.source_id
 WHERE other.namespace=i.namespace AND other.kind='session' AND other.value=i.value AND other.scope IS NULL AND owner.session_key IS NOT NULL AND owner.session_key<>s.session_key)
 LIMIT 101`;
function counters(db: Database): string {
  const changed = cachedStmt(db, 'SELECT total_changes() AS n').get() as { n: number };
  return String(db.pragma('data_version', { simple: true })) + ':' + changed.n;
}
function decoded(value: Buffer | null): string | null {
  if (value === null) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); } catch { return null; }
}
export function createArchitectureDiagnosisCollector(deps: ArchitectureCollectorDependencies): {
  collect(taskId: string, member?: string, signal?: AbortSignal): Promise<ArchitectureDiagnosisInput>;
  close(): void;
} {
  let closed = false, active: AbortController | null = null;
  return {
    close() { closed = true; active?.abort(); },
    async collect(taskId, member = 'all', callerSignal) {
      if (closed || active) throw new ArchitectureDiagnosisError('BUSY');
      const controller = new AbortController(); active = controller;
      const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
      try {
        signal.throwIfAborted();
        const startCounter = counters(deps.db), context = getTask(deps.db, taskId), selected = recordMembers(context, member);
        const keys = selected.flatMap(value => value.sessionKey ? [value.sessionKey] : []), encodedKeys = JSON.stringify(keys);
        const reasons = [...context.warnings], evidence: ArchitectureEvidence[] = [];
        const writer: EvidenceWriter = { add(value) {
          if (evidence.length >= 512) { reasons.push('evidence_limit'); return null; }
          const id = 'e' + (evidence.length + 1); evidence.push({ ...value, id, taskId: context.task.id }); return id;
        } };
        const empty: ArchitectureDiagnosisInput = { version: 1, taskId: context.task.id, title: context.task.title, member, origin: context.task.origin, revision: '', evidence,
          contexts: [], outcomes: [], handoffs: [], coverage: { context: 'unavailable', tools: 'unavailable', handoffs: 'unavailable', nativeEvents: 0,
            nativeEventTotal: context.task.eventCount, captures: 0, logicalCalls: 0, omitted: 0, reasons } };
        if (context.importSession) {
          reasons.push('imported_native_evidence_unsupported'); empty.revision = createHash('sha256').update(JSON.stringify(context)).digest('hex'); return empty;
        }
        if (selected.some(value => !value.detailLoaded)) reasons.push('native_detail_not_loaded');
        const first = taskRecords(deps.db, context, { member, offset: 0, limit: 200 });
        const records = [...first.items];
        if (first.hasMore) records.push(...taskRecords(deps.db, context, { member, offset: 200, limit: 200, window: first.window }).items);
        if (first.total > records.length) reasons.push('native_metadata_limit');
        const eligible = records.filter(value => value.event && (value.event.kind === 'tool' || value.event.kind === 'llm' || value.event.kind === 'user_prompt' || value.event.kind === 'subagent_prompt'));
        const chosen = eligible.length <= 64 ? eligible : [...eligible.slice(0, 32), ...eligible.slice(-32)];
        if (eligible.length > chosen.length) reasons.push('native_body_limit');
        const bodies = cachedStmt(deps.db, BODIES_SQL).all(JSON.stringify(chosen.map(value => [value.sessionKey, value.event!.id]))) as BodyRow[];
        const byKey = new Map(selected.map(value => [value.sessionKey, value]));
        const initialRows = cachedStmt(deps.db, "SELECT session_id,MIN(sequence) AS n FROM events WHERE session_id IN (SELECT value FROM json_each(?)) AND kind IN ('user_prompt','subagent_prompt') GROUP BY session_id").all(encodedKeys) as { session_id: string; n: number }[];
        const initial = new Map(initialRows.map(value => [value.session_id, value.n]));
        const nativeBodies: NativeBody[] = bodies.map(row => ({ sessionKey: row.session_id, eventId: row.id, agentId: byKey.get(row.session_id)!.id, order: row.sequence,
          raw: decoded(row.raw), input: decoded(row.input), output: decoded(row.output), rawComplete: row.raw_len !== null && row.raw_len <= 65536,
          inputComplete: row.input_len <= 65536, outputComplete: row.output_len <= 65536, status: row.status, initialInput: initial.get(row.session_id) === row.sequence }));
        const targetRows = cachedStmt(deps.db, TARGETS_SQL).all(encodedKeys) as { session_key: string; value: string }[];
        const targets: NativeTarget[] = targetRows.slice(0, 100).map(row => ({ nativeId: row.value, agentId: byKey.get(row.session_key)!.id, sessionKey: row.session_key, parentId: byKey.get(row.session_key)!.parentId }));
        const captureRows = cachedStmt(deps.db, CAPTURES_SQL).all(encodedKeys, encodedKeys) as CaptureRow[];
        if (captureRows.length > 8) reasons.push('capture_limit');
        const native = await extractNativeFacts(nativeBodies, writer, signal); reasons.push(...native.reasons);
        const captureCalls: Array<{ scope: string; call: typeof native.calls[number] }> = [], results: CaptureResult[] = [];
        let captures = 0, logicalCalls = 0, omittedCalls = 0;
        const fingerprints: string[] = [];
        for (const capture of captureRows.slice(0, 8)) {
          signal.throwIfAborted();
          if (logicalCalls >= 32) { reasons.push('logical_call_limit'); break; }
          try {
            if (capture.method === 'WS') {
              if (!deps.loadCodex) { reasons.push('codex_projection_unavailable'); continue; }
              const batch = await deps.loadCodex(capture.id, signal); signal.throwIfAborted();
              fingerprints.push(batch.fingerprint); captures += 1;
              if (!batch.complete) reasons.push('codex_projection_partial', ...batch.reasons);
              const remaining = 32 - logicalCalls;
              const roots = new Map<number, { root: number; native: string | null }>();
              for (const call of batch.calls.slice(0, remaining)) {
                const nativeOwner = call.call.nativeSessionId ? targets.filter(value => value.nativeId === call.call.nativeSessionId) : [];
                const owner = nativeOwner.length === 1 ? nativeOwner[0]! : null;
                const previous = call.call.predecessorSequence === null ? undefined : roots.get(call.call.predecessorSequence);
                const root = owner !== null && previous?.native === call.call.nativeSessionId ? previous.root : call.call.sequence;
                roots.set(call.call.sequence, { root, native: call.call.nativeSessionId });
                // A WS lane is transport metadata, not conversation identity. Only a
                // verified native owner plus explicit previous-response lineage groups calls.
                const scope = owner ? `codex:${capture.id}:native:${owner.sessionKey}:lineage:${root}` : `codex:${capture.id}:call:${call.call.sequence}`;
                const facts = extractCaptureFacts({ id: capture.id, callSequence: call.call.sequence, streamId: scope,
                  agentId: owner?.agentId ?? null, sessionKey: owner?.sessionKey ?? null, order: call.call.sequence,
                  analysis: call.analysis, requestBody: call.requestBody, requestComplete: call.requestComplete }, writer);
                if (facts.context) empty.contexts.push(facts.context);
                captureCalls.push(...facts.calls.map(value => ({ scope, call: value }))); results.push(...facts.results); reasons.push(...facts.reasons); logicalCalls += 1;
              }
              omittedCalls += Math.max(0, batch.total - Math.min(batch.calls.length, remaining));
              if (batch.total > batch.calls.length || batch.calls.length > remaining) reasons.push('logical_call_limit');
            } else {
              const source = await deps.loadCapture(capture.id, signal); signal.throwIfAborted(); fingerprints.push(source.fingerprint); captures += 1;
              // Session membership scopes an observation, never an HTTP conversation/call lineage.
              const scope = `http:capture:${capture.id}`;
              const facts = extractCaptureFacts({ id: capture.id, callSequence: null, streamId: scope, agentId: null, sessionKey: null,
                order: Date.parse(capture.started_at), analysis: source.analysis, requestBody: source.requestBody, requestComplete: source.requestComplete }, writer);
              if (facts.context) empty.contexts.push(facts.context);
              captureCalls.push(...facts.calls.map(call => ({ scope, call }))); results.push(...facts.results); reasons.push(...facts.reasons); logicalCalls += 1;
            }
          } catch (error) {
            signal.throwIfAborted();
            const reason = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
            if (/DELETED|SOURCE_CHANGED|CAPTURE_ANALYSIS_CONFLICT/.test(reason)) throw new ArchitectureDiagnosisError('SOURCE_CHANGED');
            reasons.push(capture.method === 'WS' ? 'codex_source_unavailable' : 'capture_source_unavailable');
          }
        }
        empty.contexts.unshift(...native.contexts);
        empty.outcomes.push(...native.outcomes, ...pairCaptureResults(captureCalls, results));
        // Exact native scoped call IDs may be seen in both source domains. Keep one occurrence.
        const outcomeKeys = new Set<string>();
        empty.outcomes = empty.outcomes.filter(value => { const key = value.agentId && value.callId ? `${value.agentId}:${value.callId}` : value.id;
          if (outcomeKeys.has(key)) return false; outcomeKeys.add(key); return true; });
        const nativeCallIds = new Set(native.calls.map(value => `${value.agentId}:${value.id}`));
        empty.handoffs = linkNativeHandoffs([...native.calls, ...captureCalls.filter(value => !nativeCallIds.has(`${value.call.agentId}:${value.call.id}`)).map(value => value.call)], native.inputs, targets);
        if (empty.handoffs.length === 32) reasons.push('handoff_limit');
        const omitted = Math.max(0, first.total - chosen.length) + Math.max(0, captureRows.length - 8) + omittedCalls;
        const allContextComplete = empty.contexts.length > 0 && empty.contexts.every(value => value.contextComplete);
        const allCatalogsComplete = empty.contexts.length > 0 && empty.contexts.every(value => value.toolCatalogComplete);
        const noOmission = omitted === 0 && reasons.length === 0;
        empty.coverage = { context: empty.contexts.length ? allContextComplete && noOmission ? 'complete' : 'partial' : 'unavailable',
          tools: empty.contexts.length || empty.outcomes.length || native.calls.length ? allCatalogsComplete && noOmission ? 'complete' : 'partial' : 'unavailable',
          handoffs: empty.handoffs.length ? empty.handoffs.every(value => value.linkage === 'explicit' && value.sentComplete && value.receivedComplete && value.receivedRefId !== null) && noOmission ? 'complete' : 'partial' : 'unavailable',
          nativeEvents: nativeBodies.length, nativeEventTotal: first.total, captures, logicalCalls, omitted,
          reasons: [...new Set([...reasons, ...(empty.handoffs.length ? [] : ['handoff_receiver_evidence_unavailable'])])].slice(0, 64) };
        signal.throwIfAborted();
        if (counters(deps.db) !== startCounter || JSON.stringify(getTask(deps.db, taskId)) !== JSON.stringify(context)) throw new ArchitectureDiagnosisError('SOURCE_CHANGED');
        empty.revision = createHash('sha256').update(JSON.stringify([context, first.window, startCounter, fingerprints])).digest('hex');
        return empty;
      } finally { if (active === controller) active = null; }
    },
  };
}
export type ArchitectureDiagnosisCollector = ReturnType<typeof createArchitectureDiagnosisCollector>;
