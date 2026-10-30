import type { HealthInput, HealthRecord, HealthRound, HealthSpan } from './types.js';
export function relativeTime(input: HealthInput, value: string | null): number | null {
    if (value === null)
        return null;
    const n = Date.parse(value) - Date.parse(input.t0);
    return Number.isFinite(n) ? n : null;
}
export function traceLogSnapshot(input: HealthInput, record: HealthRecord, index: number): {
    round: HealthRound;
    spans: HealthSpan[];
} {
    const turn = record.importedTurn!;
    const start = relativeTime(input, turn.requestTime), end = relativeTime(input, turn.responseTime);
    const reasoning = turn.reported.thoughts_token_count === 0 ? 'zero' : (turn.reported.thoughts_token_count ?? 0) > 0 ? 'present' : 'unknown';
    const ttft = turn.reported.ttft_ms;
    const first = start !== null && ttft !== null && ttft !== undefined && ttft >= 0 && (end === null || start + ttft <= end) ? start + ttft : null;
    const id = `${record.memberId}:import:${turn.sequence}`;
    const round: HealthRound = { id, memberId: record.memberId, index, readyMs: start, firstOutputMs: first, modelEndMs: null, endMs: end, toolSpanIds: [], writeFiles: 0, parallelTools: 0, reasoning };
    // Request/response is a reported envelope, not invented model/tool placement.
    const span: HealthSpan = { id: record.recordId, memberId: record.memberId, recordId: record.recordId, kind: 'other', toolClass: null, title: (turn.turnId ?? 'TraceLog request').slice(0, 200), startMs: start, endMs: end !== null && start !== null && end >= start ? end : null, timing: 'reported', capped: false, roundId: id, status: turn.isError === true ? 'error' : turn.isError === false ? 'ok' : 'unknown', model: turn.model, reasoning, tokens: null, firstContentMs: first, firstContentLayer: first === null ? null : 'exporter', outputChars: record.outputLen };
    return { round, spans: [span] };
}
