import type { FindingDraft, RuleContext } from '../metrics.js';
import { fact, metric } from '../metrics.js';
import { sequence } from '../snapshot.js';
export function planRules(c: RuleContext): FindingDraft[] {
    const { snapshot: s, thresholds: t } = c, out: FindingDraft[] = [];
    const n = metric(c, 'plan.rounds')?.value;
    if (n != null && t.roundBaseline !== null && n > t.roundBaseline * t.roundMultiplier)
        out.push(fact('plan.many_rounds', 'plan', { N: n, baseline: t.roundBaseline }, [], s.records.map(r => 'evidence:' + r.recordId)));
    const write = metric(c, 'ux.first_write_log')?.value, rawWrite = metric(c, 'ux.first_write_log', { component: 'raw' })?.value, e2e = metric(c, 'overview.e2e_ms', { component: 'active' })?.value;
    if (write != null && e2e != null && e2e > 0 && 100 * write / e2e > t.explorePct)
        out.push(fact('plan.explore_heavy', 'plan', { pct: 100 * write / e2e }, s.tools.filter(x => x.span.endMs !== null && rawWrite != null && x.span.endMs <= rawWrite)));
    const reads = new Map<string, typeof s.tools>();
    for (const x of [...s.tools].sort((a, b) => sequence(a.source) - sequence(b.source))) {
        for (const target of x.targets) {
            const key = JSON.stringify([x.span.memberId, target]);
            if (x.span.toolClass === 'write/edit') {
                const group = reads.get(key) ?? [];
                if (group.length >= t.repeatedReads)
                    out.push(fact('plan.repeated_reads', 'plan', { file: target, count: group.length }, group));
                reads.delete(key);
            }
            else if (x.span.toolClass === 'read') {
                const group = reads.get(key) ?? [];
                group.push(x);
                reads.set(key, group);
            }
        }
    }
    for (const [key, group] of reads)
        if (group.length >= t.repeatedReads)
            out.push(fact('plan.repeated_reads', 'plan', { file: (JSON.parse(key) as string[])[1]!, count: group.length }, group));
    for (const member of s.members) {
        const tools = s.tools.filter(x => x.span.memberId === member.id).sort((a, b) => sequence(a.source) - sequence(b.source));
        const targets = new Set(tools.filter(x => x.span.toolClass === 'write/edit').flatMap(x => x.targets));
        for (const target of targets) {
            let prior: typeof tools[number] | null = null, failed = false;
            const chain: typeof tools = [];
            for (const x of tools) {
                if (x.span.toolClass === 'write/edit' && x.targets.includes(target)) {
                    if (prior && failed && prior.span.roundId !== x.span.roundId) {
                        chain.push(prior, x);
                    }
                    prior = x;
                    failed = false;
                }
                else if (['test', 'build', 'lint/typecheck'].includes(x.span.toolClass!) && x.span.status === 'error' && x.targets.includes(target) && prior) {
                    failed = true;
                    chain.push(x);
                }
            }
            const count = new Set(chain.filter(x => x.span.toolClass === 'write/edit').map(x => x.span.roundId)).size;
            if (count >= t.reworkRounds)
                out.push(fact('plan.rework_chain', 'plan', { file: target, count }, [...new Set(chain)]));
        }
    }
    return out;
}
