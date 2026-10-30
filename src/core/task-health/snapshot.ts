import type { TaskNativeRef } from '../task-types.js';
import type { HealthInput, HealthMember, HealthRecord, HealthRound, HealthSpan, ReasoningState } from './types.js';
import type { Interval } from './intervals.js';
import { intersect, peak, subtract } from './intervals.js';
import { classifyTool, commandProjection, normalizePath } from './tool-class.js';
import { relativeTime, traceLogSnapshot } from './snapshot-tracelog.js';
import { timestampSemantics } from './semantics.js';
export const DERIVED_DURATION_CAP_MS = 300000;
export const nativeKey = (ref: TaskNativeRef): string => JSON.stringify([ref.namespace, ref.kind, ref.value, ref.scope]);
export const sequence = (r: HealthRecord): number => r.event?.sequence ?? r.importedTurn?.sequence ?? 0;
export const isTool = (r: HealthRecord): boolean => Boolean(r.event && ['tool', 'bash', 'file_read', 'file_write', 'test'].includes(r.event.kind));
export const isBookkeeping = (r: HealthRecord): boolean => Boolean(r.event && (r.event.kind === 'system' || r.event.kind === 'agent' || r.event.kind === 'subagent_prompt' || r.event.title === 'token_count' || r.event.kind === 'reasoning' && !r.event.title && !r.event.hasOutput));
export const isProduction = (r: HealthRecord): boolean => !isBookkeeping(r) && Boolean(r.event && (['llm', 'reasoning', 'message'].includes(r.event.kind) || isTool(r) && !(r.event.hasOutput && !r.event.hasInput)));
export interface ToolObservation {
    span: HealthSpan;
    records: HealthRecord[];
    source: HealthRecord;
    durationMs: number | null;
    targets: string[];
    command: ReturnType<typeof commandProjection>;
}
export interface Snapshot {
    input: HealthInput;
    totalMembers: number;
    members: HealthMember[];
    records: HealthRecord[];
    spans: HealthSpan[];
    rounds: HealthRound[];
    tools: ToolObservation[];
    roundRecords: Map<string, HealthRecord[]>;
    bounds: Interval | null;
    undivided: Interval[];
    userWait: Interval[];
    delegateWait: Interval[];
    reasons: string[];
    limits: string[];
}
export function located(span: HealthSpan): Interval | null { return span.startMs !== null && span.endMs !== null && span.endMs >= span.startMs ? [span.startMs, span.endMs] : null; }
export const reasoningState = (records: HealthRecord[]): ReasoningState => records.some(r => r.native.reasoning === 'present' || r.event?.kind === 'reasoning' && !isBookkeeping(r) || (r.native.usage?.reasoning ?? 0) > 0 || (r.event?.tokens?.reasoning ?? 0) > 0) ? 'present' : records.some(r => r.native.reasoning === 'zero') ? 'zero' : 'unknown';
function baseSpan(record: HealthRecord, kind: HealthSpan['kind'], roundId: string | null): HealthSpan {
    return { id: record.recordId, recordId: record.recordId, memberId: record.memberId, kind, roundId, title: (record.event?.title ?? '').slice(0, 200), toolClass: null, startMs: null, endMs: null, timing: 'unavailable', capped: false, status: record.event?.status === 'error' ? 'error' : record.event?.status === 'success' ? 'ok' : 'unknown', model: record.event?.model ?? null, reasoning: reasoningState([record]), tokens: record.native.usage, firstContentMs: null, firstContentLayer: null, outputChars: record.outputLen };
}
/** Pure reconstruction. Context records remain available until after pairing. */
export function buildSnapshot(input: HealthInput): Snapshot {
    const selected = input.members.filter(m => input.scope.member === 'all' || input.scope.member === 'main' && m.parentId === null || m.id === input.scope.member);
    const members = selected.slice(0, 100), ids = new Set(members.map(m => m.id));
    const records = input.records.filter(r => ids.has(r.memberId)).slice(0, 20000);
    const out: Snapshot = { input, totalMembers: selected.length, members, records, spans: [], rounds: [], tools: [], roundRecords: new Map(), bounds: null, undivided: [], userWait: [], delegateWait: [], reasons: [...input.reasons], limits: [...input.limits] };
    if (selected.length > 100)
        out.limits.push('members');
    if (input.records.filter(r => ids.has(r.memberId)).length > 20000)
        out.limits.push('events');
    const time = (r: HealthRecord) => relativeTime(input, r.event?.startedAt ?? r.importedTurn?.requestTime ?? null);
    for (const member of members) {
        const list = records.filter(r => r.memberId === member.id).sort((a, b) => sequence(a) - sequence(b));
        const semantics = member.timestampSemantics ?? timestampSemantics(member.provider, member.durationSource);
        const assignments = new Map<string, string>();
        let fallback = 0, current: string | null = null, afterResult = false;
        for (const r of list) {
            if (r.importedTurn) {
                const t = traceLogSnapshot(input, r, out.rounds.filter(x => x.memberId === member.id).length + 1);
                out.rounds.push(t.round);
                out.spans.push(...t.spans);
                out.roundRecords.set(t.round.id, [r]);
                continue;
            }
            if (r.event?.kind === 'user_prompt') {
                current = null;
                afterResult = false;
                continue;
            }
            if (!isProduction(r) && !isTool(r))
                continue;
            let id = r.event?.turnKey ?? (r.round ? JSON.stringify([member.id, r.round.namespace, r.round.kind, r.round.value, r.round.scope]) : null);
            if (id === null) {
                if (current === null || afterResult && isProduction(r)) {
                    current = `${member.id}:fallback:${++fallback}`;
                    out.reasons.push('fallback_segmentation');
                }
                id = current;
            }
            current = id;
            assignments.set(r.recordId, id);
            const group = out.roundRecords.get(id) ?? [];
            group.push(r);
            out.roundRecords.set(id, group);
            afterResult = isTool(r) && Boolean(r.event?.hasOutput && !r.event.hasInput);
        }
        const toolGroups = new Map<string, HealthRecord[]>();
        for (const r of list.filter(isTool)) {
            const key = r.tool && r.pairing === 'exact' ? JSON.stringify([member.id, nativeKey(r.tool)]) : r.recordId;
            const group = toolGroups.get(key) ?? [];
            group.push(r);
            toolGroups.set(key, group);
        }
        for (const group of toolGroups.values()) {
            const calls = group.filter(r => r.event?.hasInput), results = group.filter(r => r.event?.hasOutput && !r.event.hasInput);
            const r = calls[0] ?? group[0]!, span = baseSpan(r, classifyTool(r) === 'delegate' ? 'delegate' : 'tool', assignments.get(r.recordId) ?? null);
            span.toolClass = classifyTool(r);
            let start = relativeTime(input, r.native.toolStartedAt), end = relativeTime(input, r.native.toolCompletedAt);
            if (start !== null && end !== null && end >= start) {
                span.timing = semantics === 'interval' ? 'measured' : 'observed';
            }
            else if (semantics === 'completion' && r.pairing === 'exact' && calls.length === 1 && results.length === 1 && group.length === 2) {
                start = time(calls[0]!);
                end = time(results[0]!);
                span.timing = 'observed';
            }
            else {
                start = null;
                end = null;
                span.timing = 'derived';
            }
            let duration = start !== null && end !== null && end >= start ? end - start : null;
            if (duration === null) {
                span.timing = 'derived';
                const d = r.event?.durationMs;
                if (d !== undefined && Number.isFinite(d) && d > 0) {
                    duration = d;
                    start = time(r);
                    end = start === null ? null : start + d;
                    span.capped = d >= DERIVED_DURATION_CAP_MS && member.durationSource !== 'measured' && semantics === 'completion';
                }
                else
                    span.timing = 'unavailable';
            }
            if (start !== null && end !== null && end < start) {
                start = null;
                end = null;
                duration = null;
                span.timing = 'unavailable';
                out.reasons.push('invalid_tool_clock');
            }
            if (semantics === 'unknown' && span.timing === 'derived' || semantics === 'start' && span.timing === 'derived') {
                start = null;
                end = null;
            }
            span.startMs = start;
            span.endMs = end;
            const result = results[0] ?? group.at(-1)!;
            span.status = result.event?.status === 'error' ? 'error' : result.event?.status === 'success' ? 'ok' : 'unknown';
            const targets = [...new Set(group.flatMap(x => x.native.targets).map(normalizePath))];
            out.spans.push(span);
            out.tools.push({ span, records: group, source: r, durationMs: duration, targets, command: commandProjection(r.native.command, r.native.cwd ?? member.cwd) });
        }
        let ready: number | null = time(list.find(r => r.event?.kind === 'user_prompt' && !isBookkeeping(r)) ?? ({ event: null, importedTurn: null } as HealthRecord));
        const groups = [...out.roundRecords].filter(([, rs]) => rs[0]?.memberId === member.id && !rs[0]?.importedTurn);
        for (let i = 0; i < groups.length; i++) {
            const [id, rs] = groups[i]!, productions = rs.filter(isProduction), points = productions.map(time).filter((n): n is number => n !== null);
            const tools = out.tools.filter(t => t.span.roundId === id), exact = tools.filter(t => ['observed', 'measured'].includes(t.span.timing));
            const first = points.length ? Math.min(...points) : null, last = points.length ? Math.max(...points) : null;
            const ends = tools.map(t => t.span.endMs).filter((n): n is number => n !== null);
            const round: HealthRound = { id, memberId: member.id, index: i + 1, readyMs: ready, firstOutputMs: null, modelEndMs: null, endMs: ends.length ? Math.max(...ends) : last, toolSpanIds: tools.map(t => t.span.id), writeFiles: new Set(tools.filter(t => t.span.toolClass === 'write/edit').flatMap(t => t.targets)).size, parallelTools: peak(exact.flatMap(t => { const l = located(t.span); return l ? [l] : []; })), reasoning: reasoningState(rs) };
            if (semantics === 'completion' && ready !== null && first !== null && last !== null && first >= ready) {
                round.firstOutputMs = first;
                round.modelEndMs = last;
                const span = baseSpan(productions[0]!, 'model', id);
                const models = [...new Set(productions.flatMap(r => r.event?.model ? [r.event.model] : []))];
                span.model = models.length === 1 ? models[0]! : null;
                span.id = `${id}:model`;
                span.startMs = ready;
                span.endMs = last;
                span.timing = 'derived';
                span.reasoning = round.reasoning;
                span.firstContentMs = first;
                span.firstContentLayer = 'log_upper_bound';
                out.spans.push(span);
            }
            else if (semantics === 'interval') {
                const starts = productions.map(r => relativeTime(input, r.native.modelStartedAt)).filter((n): n is number => n !== null), completions = productions.map(r => relativeTime(input, r.native.modelCompletedAt)).filter((n): n is number => n !== null);
                if (starts.length && completions.length) {
                    const s = Math.min(...starts), e = Math.max(...completions);
                    if (e >= s) {
                        const span = baseSpan(productions[0]!, 'model', id);
                        const models = [...new Set(productions.flatMap(r => r.event?.model ? [r.event.model] : []))];
                        span.model = models.length === 1 ? models[0]! : null;
                        span.id = `${id}:model`;
                        span.startMs = s;
                        span.endMs = e;
                        span.timing = 'measured';
                        span.reasoning = round.reasoning;
                        const contents = productions.map(r => relativeTime(input, r.native.firstContentAt)).filter((n): n is number => n !== null && n >= s && n <= e);
                        round.readyMs = s;
                        round.modelEndMs = e;
                        round.firstOutputMs = contents.length ? Math.min(...contents) : null;
                        out.spans.push(span);
                    }
                }
            }
            else if (semantics === 'start') {
                const start = rs.map(time).find(n => n !== null) ?? null;
                const next = groups[i + 1]?.[1][0];
                const end = next ? time(next) : round.endMs;
                if (start !== null && end !== null && end >= start)
                    out.undivided.push([start, end]);
            }
            if (semantics === 'interval' && round.modelEndMs === null) {
                const start = rs.map(time).find(n => n !== null) ?? null, next = groups[i + 1]?.[1][0], end = next ? time(next) : round.endMs;
                if (start !== null && end !== null && end >= start)
                    out.undivided.push([start, end]);
            }
            out.rounds.push(round);
            const exactEnds = exact.map(t => t.span.endMs).filter((n): n is number => n !== null);
            ready = tools.length ? (exactEnds.length === tools.length ? Math.max(...exactEnds) : null) : last;
        }
        for (let i = 0; i < list.length; i++) {
            const r = list[i]!;
            if (r.native.requestsUserInput !== true)
                continue;
            const next = list.slice(i + 1).find(x => x.event?.kind === 'user_prompt');
            const a = time(r), b = next ? time(next) : input.running ? relativeTime(input, input.snapshotAt) : null;
            if (a !== null && b !== null && b >= a)
                out.userWait.push([a, b]);
        }
    }
    const observations = records.filter(r => !isBookkeeping(r)).flatMap(r => { const a = time(r), b = relativeTime(input, r.importedTurn?.responseTime ?? null); return [...(a === null ? [] : [a]), ...(b === null ? [] : [b])]; });
    const ends = out.spans.filter(s => ['measured', 'observed', 'reported'].includes(s.timing)).flatMap(s => s.endMs === null ? [] : [s.endMs]);
    const rawEnd = input.running ? relativeTime(input, input.snapshotAt) : Math.max(0, ...observations, ...ends);
    if (!input.reasons.includes('missing_origin') && rawEnd !== null) {
        const from = input.scope.from === null ? 0 : relativeTime(input, input.scope.from), to = input.scope.to === null ? rawEnd : relativeTime(input, input.scope.to);
        if (from !== null && to !== null)
            out.bounds = intersect([0, rawEnd], [from, to]);
    }
    for (const t of out.tools) {
        const child = t.source.native.delegateMemberId, interval = located(t.span);
        if (!child || !interval || t.source.pairing !== 'exact' || !members.some(m => m.id === child))
            continue;
        const mainWork = out.spans.filter(s => s.memberId === t.span.memberId && s.id !== t.span.id && s.kind !== 'delegate').flatMap(s => { const l = located(s); return l ? [l] : []; });
        out.delegateWait.push(...subtract([interval], mainWork));
    }
    if (out.bounds) {
        const bounds = out.bounds;
        // Clipped spans are the selected work; retain original duration only internally.
        out.spans = out.spans.filter(s => {
            const l = located(s);
            if (!l)
                return true;
            const c = intersect(l, bounds);
            if (!c)
                return false;
            s.startMs = c[0];
            s.endMs = c[1];
            return true;
        });
        const retained = new Set(out.spans.map(s => s.id));
        out.tools = out.tools.filter(t => retained.has(t.span.id));
        out.rounds = out.rounds.filter(r => { const s = r.readyMs ?? r.firstOutputMs, e = r.endMs ?? r.modelEndMs; return s === null || e === null || intersect([s, e], bounds) !== null; });
        for (const r of out.rounds) {
            r.toolSpanIds = r.toolSpanIds.filter(id => retained.has(id));
            if (r.readyMs !== null)
                r.readyMs = Math.max(bounds[0], r.readyMs);
            if (r.modelEndMs !== null)
                r.modelEndMs = Math.min(bounds[1], r.modelEndMs);
            if (r.endMs !== null)
                r.endMs = Math.min(bounds[1], r.endMs);
        }
    }
    if (out.spans.filter(s => s.kind === 'model' || s.kind === 'tool' || s.kind === 'delegate').length > 2000) {
        out.limits.push('spans');
        out.spans = out.spans.slice(0, 2000);
        const ids = new Set(out.spans.map(s => s.id));
        out.tools = out.tools.filter(t => ids.has(t.span.id));
        for (const r of out.rounds)
            r.toolSpanIds = r.toolSpanIds.filter(id => ids.has(id));
    }
    out.reasons = [...new Set(out.reasons)];
    out.limits = [...new Set(out.limits)];
    return out;
}
