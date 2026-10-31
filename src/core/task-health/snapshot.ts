import type { TaskNativeRef } from '../task-types.js';
import type { HealthInput, HealthMember, HealthRecord, HealthRound, HealthSpan, ReasoningState } from './types.js';
import type { Interval } from './intervals.js';
import { intersect, peak, subtract, union } from './intervals.js';
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
export interface MemberWait {
    memberId: string;
    component: 'between_turns' | 'requested';
    intervalMs: Interval;
    recordIds: string[];
}
interface UserTurn { prompt: HealthRecord | null; records: HealthRecord[]; boundary: number | null }
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
    memberWaits: MemberWait[];
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
    const out: Snapshot = { input, totalMembers: selected.length, members, records, spans: [], rounds: [], tools: [], roundRecords: new Map(), bounds: null, undivided: [], userWait: [], memberWaits: [], delegateWait: [], reasons: [...input.reasons], limits: [...input.limits] };
    if (selected.length > 100)
        out.limits.push('members');
    if (input.records.filter(r => ids.has(r.memberId)).length > 20000)
        out.limits.push('events');
    const time = (r: HealthRecord) => relativeTime(input, r.event?.startedAt ?? r.importedTurn?.requestTime ?? null);
    const memberUndivided: { memberId: string; intervalMs: Interval }[] = [];
    for (const member of members) {
        const list = records.filter(r => r.memberId === member.id).sort((a, b) => sequence(a) - sequence(b));
        const semantics = member.timestampSemantics ?? timestampSemantics(member.provider, member.durationSource);
        const turns: UserTurn[] = [{ prompt: null, records: [], boundary: null }];
        const recordTurns = new Map<string, UserTurn>();
        for (const r of list) {
            if (r.event?.kind === 'user_prompt' && !isBookkeeping(r)) {
                turns.at(-1)!.boundary = time(r);
                turns.push({ prompt: r, records: [], boundary: null });
            }
            turns.at(-1)!.records.push(r); recordTurns.set(r.recordId, turns.at(-1)!);
        }
        const turnBounds = (span: HealthSpan, turn: UserTurn) => {
            const start = turn.prompt ? time(turn.prompt) : null;
            if (span.startMs !== null && start !== null) span.startMs = Math.max(start, span.startMs);
            if (span.endMs !== null && turn.boundary !== null && span.endMs > turn.boundary) {
                span.endMs = turn.boundary; out.reasons.push('cross_turn_interval_clipped');
            }
            if (span.startMs !== null && span.endMs !== null && span.endMs < span.startMs) {
                span.startMs = null; span.endMs = null; out.reasons.push('invalid_turn_clock');
            }
        };
        const firstTurnForKey = new Map<string, UserTurn>(), roundTurns = new Map<string, UserTurn>();
        const callsByTool = new Map<string, HealthRecord>();
        for (const r of list) if (isTool(r) && r.tool && r.pairing === 'exact' && r.event?.hasInput) callsByTool.set(nativeKey(r.tool), r);
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
            const turn = recordTurns.get(r.recordId)!;
            // A late partner remains pairing context, not a new turn's decision.
            const call = r.tool && r.pairing === 'exact' ? callsByTool.get(nativeKey(r.tool)) : null;
            if (call && !r.event?.hasInput && recordTurns.get(call.recordId) !== turn) continue;
            let id = r.event?.turnKey ?? (r.round ? JSON.stringify([member.id, r.round.namespace, r.round.kind, r.round.value, r.round.scope]) : null);
            if (id === null) {
                if (current === null || afterResult && isProduction(r)) {
                    current = `${member.id}:fallback:${++fallback}`;
                    out.reasons.push('fallback_segmentation');
                }
                id = current;
            }
            if (id !== null && (r.event?.turnKey || r.round)) {
                const first = firstTurnForKey.get(id);
                if (first && first !== turn) id = `${id}@${turn.prompt!.recordId}`;
                else if (!first) firstTurnForKey.set(id, turn);
            }
            roundTurns.set(id, turn);
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
            const beforeTurnClip = located(span);
            turnBounds(span, recordTurns.get(r.recordId)!);
            const afterTurnClip = located(span);
            if (beforeTurnClip && afterTurnClip && (beforeTurnClip[0] !== afterTurnClip[0] || beforeTurnClip[1] !== afterTurnClip[1])) duration = afterTurnClip[1] - afterTurnClip[0];
            const result = results[0] ?? group.at(-1)!;
            span.status = result.event?.status === 'error' ? 'error' : result.event?.status === 'success' ? 'ok' : 'unknown';
            const targets = [...new Set(group.flatMap(x => x.native.targets).map(normalizePath))];
            out.spans.push(span);
            out.tools.push({ span, records: group, source: r, durationMs: duration, targets, command: commandProjection(r.native.command, r.native.cwd ?? member.cwd) });
        }
        let ready: number | null = null, previousTurn: UserTurn | null = null;
        const groups = [...out.roundRecords].filter(([, rs]) => rs[0]?.memberId === member.id && !rs[0]?.importedTurn);
        for (let i = 0; i < groups.length; i++) {
            const [id, rs] = groups[i]!;
            const turn = roundTurns.get(id)!;
            if (turn !== previousTurn) { ready = turn.prompt ? time(turn.prompt) : null; previousTurn = turn; }
            const productions = rs.filter(isProduction), points = productions.map(time).filter((n): n is number => n !== null);
            const tools = out.tools.filter(t => t.span.roundId === id), exact = tools.filter(t => ['observed', 'measured'].includes(t.span.timing));
            const first = points.length ? Math.min(...points) : null, last = points.length ? Math.max(...points) : null;
            const ends = tools.map(t => t.span.endMs).filter((n): n is number => n !== null);
            const round: HealthRound = { id, memberId: member.id, index: i + 1, readyMs: ready, firstOutputMs: null, modelEndMs: null, endMs: ends.length ? Math.max(...ends, ...(last === null ? [] : [last])) : last, toolSpanIds: tools.map(t => t.span.id), writeFiles: new Set(tools.filter(t => t.span.toolClass === 'write/edit').flatMap(t => t.targets)).size, parallelTools: peak(exact.flatMap(t => { const l = located(t.span); return l ? [l] : []; })), reasoning: reasoningState(rs) };
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
                turnBounds(span, turn);
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
                        turnBounds(span, turn);
                        out.spans.push(span);
                    }
                }
            }
            else if (semantics === 'start') {
                const start = rs.map(time).find(n => n !== null) ?? null;
                const next = groups[i + 1] && roundTurns.get(groups[i + 1]![0]) === turn ? groups[i + 1]![1][0] : undefined;
                const end = next ? time(next) : round.endMs;
                if (start !== null && end !== null && end >= start)
                    memberUndivided.push({ memberId: member.id, intervalMs: [start, turn.boundary === null ? end : Math.min(end, turn.boundary)] });
            }
            if (semantics === 'interval' && round.modelEndMs === null) {
                const start = rs.map(time).find(n => n !== null) ?? null, next = groups[i + 1] && roundTurns.get(groups[i + 1]![0]) === turn ? groups[i + 1]![1][0] : undefined, end = next ? time(next) : round.endMs;
                if (start !== null && end !== null && end >= start)
                    memberUndivided.push({ memberId: member.id, intervalMs: [start, turn.boundary === null ? end : Math.min(end, turn.boundary)] });
            }
            if (turn.boundary !== null) {
                for (const key of ['modelEndMs', 'endMs'] as const) if (round[key] !== null) round[key] = Math.min(round[key]!, turn.boundary);
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
                out.memberWaits.push({ memberId: member.id, component: 'requested', intervalMs: [a, b], recordIds: [r.recordId, ...(next ? [next.recordId] : [])] });
        }
        for (let i = 0; i + 1 < turns.length; i++) {
            const turn = turns[i]!, next = turns[i + 1]!.prompt!;
            if (!turn.records.length) continue;
            const turnTools = out.tools.filter(t => recordTurns.get(t.source.recordId) === turn);
            const points = turn.records.filter(isProduction).map(time).filter((n): n is number => n !== null);
            const intervals = turnTools.flatMap(t => { const value = located(t.span); return value ? [value] : []; });
            const unknown = turnTools.some(t => !located(t.span) || t.span.capped || t.records.at(-1)?.event?.status === 'running')
                || turn.records.some(r => isProduction(r) && (r.event?.status === 'running' || time(r) === null))
                || semantics === 'unknown' || semantics === 'start'
                || semantics === 'interval' && turn.records.some(r => isProduction(r) && r.native.modelCompletedAt === null);
            const completions = turn.records.flatMap(r => { const end = relativeTime(input, r.native.modelCompletedAt); return end === null ? [] : [end]; });
            const ends = [...points, ...intervals.map(i => i[1]), ...completions];
            const end = ends.length ? Math.max(...ends) : null, until = time(next);
            if (unknown || end === null || until === null) { out.reasons.push('turn_end_unknown'); continue; }
            if (until > end) {
                const requested = out.memberWaits.filter(w => w.memberId === member.id && w.component === 'requested').map(w => w.intervalMs);
                const endpoint = turn.records.filter(r => isProduction(r) || isTool(r)).at(-1);
                for (const intervalMs of subtract([[end, until]], requested)) out.memberWaits.push({ memberId: member.id, component: 'between_turns', intervalMs, recordIds: [...(endpoint ? [endpoint.recordId] : []), next.recordId] });
            }
        }
    }
    // Remove only the owner's waits from work. Other selected members' actual
    // activity remains intact and shields that part from task-level userWait.
    const ownWaits = new Map(members.map(m => [m.id, union(out.memberWaits.filter(w => w.memberId === m.id).map(w => w.intervalMs))]));
    for (const span of out.spans) {
        const interval = located(span); if (!interval) continue;
        const pieces = subtract([interval], ownWaits.get(span.memberId) ?? []);
        if (!pieces.length) { span.startMs = null; span.endMs = null; }
        else { span.startMs = pieces[0]![0]; span.endMs = pieces[0]![1]; }
    }
    for (const tool of out.tools) {
        const waits = ownWaits.get(tool.span.memberId) ?? [], original = located(tool.span);
        if (original && waits.length && tool.durationMs !== null) tool.durationMs = original[1] - original[0];
        else if (!original && waits.length && tool.span.timing !== 'unavailable') { tool.durationMs = null; tool.span.timing = 'unavailable'; }
    }
    for (const round of out.rounds) for (const [start, end] of ownWaits.get(round.memberId) ?? []) {
        if (round.readyMs !== null && round.endMs !== null && round.readyMs < end && round.endMs > start) {
            round.endMs = Math.max(round.readyMs, Math.min(round.endMs, start));
            if (round.modelEndMs !== null) round.modelEndMs = Math.min(round.modelEndMs, round.endMs);
        }
    }
    out.undivided = memberUndivided.flatMap(value => subtract([value.intervalMs], ownWaits.get(value.memberId) ?? []));
    const otherActivity = new Map(members.map(m => [m.id, union(out.spans.filter(s => s.memberId !== m.id && ['model', 'tool', 'delegate'].includes(s.kind)).flatMap(s => { const value = located(s); return value ? [value] : []; }))]));
    out.userWait = union(out.memberWaits.flatMap(w => subtract([w.intervalMs], otherActivity.get(w.memberId) ?? [])));
    const observations = records.filter(r => r.importedTurn || r.event?.kind === 'user_prompt' || isProduction(r) || isTool(r)).flatMap(r => { const a = time(r), b = relativeTime(input, r.importedTurn?.responseTime ?? null); return [...(a === null ? [] : [a]), ...(b === null ? [] : [b])]; });
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
