import type { FindingDraft, RuleContext } from '../metrics.js';
import { duration, eligible, fact, installGroups, metric } from '../metrics.js';
import { located } from '../snapshot.js';
export function actRules(c: RuleContext): FindingDraft[] {
    const { snapshot: s, thresholds: t } = c, out: FindingDraft[] = [];
    const long = s.tools.filter(x => (eligible(x) || x.span.capped) && (duration(x) ?? 0) > t.longToolMs);
    for (const x of long)
        out.push(fact('act.long_tool', 'act', { command: x.source.native.command, tool: x.source.event?.tool ?? x.span.title, durationMs: duration(x), duration: x.span.capped ? '≥300s（推导值封顶）' : `${duration(x)! / 1000}s`, toolClass: x.span.toolClass, capped: String(x.span.capped) }, [x]));
    const cd = long.filter(x => x.command.cd);
    if (cd.length)
        out.push(fact('act.cd_prefix_long', 'act', { count: cd.length }, cd));
    for (const [fingerprint, group] of installGroups(s))
        if (group.length >= t.duplicateInstalls)
            out.push(fact('act.duplicate_install', 'act', { fingerprint, count: group.length, cwd: group[0]!.command.cwd, command: group[0]!.command.command }, group));
    const tools = new Map<string, typeof s.tools>();
    for (const x of s.tools) {
        const name = x.source.event?.tool ?? x.span.title;
        const group = tools.get(name) ?? [];
        group.push(x);
        tools.set(name, group);
    }
    for (const [tool, group] of tools) {
        const known = group.filter(x => x.span.status !== 'unknown'), errors = known.filter(x => x.span.status === 'error');
        let streak = 0, max = 0, signature: string | null = null;
        for (const x of group) {
            const error = x.records.find(r => r.event?.error)?.event?.error ?? null;
            if (x.span.status === 'error' && error !== null) {
                streak = error === signature ? streak + 1 : 1;
                signature = error;
                max = Math.max(max, streak);
            }
            else {
                streak = 0;
                signature = null;
            }
        }
        if (known.length >= t.toolErrorMinCalls && 100 * errors.length / known.length > t.toolErrorPct || max >= t.consecutiveErrors)
            out.push(fact('act.tool_errors', 'act', { tool, errors: errors.length, count: known.length, pct: 100 * errors.length / known.length }, errors));
    }
    const writes = s.tools.filter(x => x.span.toolClass === 'write/edit');
    const rate = metric(c, 'act.single_file_write_round_rate')?.value;
    if (writes.length && writes.every(x => x.targets.length) && new Set(writes.flatMap(x => x.targets)).size >= t.writeFiles && rate != null && rate >= t.singleFileWriteRoundPct)
        out.push(fact('act.small_write_batches', 'act', { pct: rate, count: writes.length }, writes));
    const reads = s.tools.filter(x => ['read', 'search'].includes(x.span.toolClass!) && eligible(x) && x.targets.length > 0).sort((a, b) => a.span.startMs! - b.span.startMs!);
    let chain: typeof reads = [];
    const flush = () => { if (chain.length >= t.serialReads)
        out.push(fact('act.serial_independent', 'act', { count: chain.length }, chain)); };
    for (const x of reads) {
        const last = chain.at(-1), round = s.rounds.find(r => r.id === x.span.roundId), prior = s.rounds.find(r => r.id === last?.span.roundId);
        const overlaps = reads.some(y => y !== x && y.span.memberId === x.span.memberId && located(y.span) && y.span.startMs! < x.span.endMs! && y.span.endMs! > x.span.startMs!);
        if (overlaps) {
            flush();
            chain = [];
            continue;
        }
        if (last && (last.span.memberId !== x.span.memberId || last.span.endMs! > x.span.startMs! || !round || !prior || round.index - prior.index > 1 || chain.some(y => y.targets.some(v => x.targets.includes(v))))) {
            flush();
            chain = [];
        }
        chain.push(x);
    }
    flush();
    return out;
}
