import { describe, expect, it } from 'vitest';
import golden from './__fixtures__/agent-folding-kit-golden.json';
import { kitCompare, kitCoupling, kitCoverage, kitEstimate, kitRoundEstimate } from './agent-folding-kit.js';
import type { FoldingKitResult } from './agent-folding-kit.js';

const cells = (line: string) => line.split('|').slice(1, -1).map(s => s.trim());
const table = (text: string, heading: string) => {
  const section = text.split(heading)[1]?.split('\n## ')[0] ?? '';
  return section.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| ---')).map(cells).slice(1);
};
describe('r4 P3 pinned Python kit parity (no Python needed at test time)', () => {
  it('matches every coupling, volume, sequence and merge candidate value', () => {
    expect(kitCoupling(golden.traces)).toEqual(golden.coupling);
  });
  for (const rawRun of golden.runs) {
    const run = { ...rawRun, before: rawRun.before as unknown as FoldingKitResult[], after: rawRun.after as unknown as FoldingKitResult[] };
    it(`${run.path}: chain sets, counts and task/repetition coverage match Python`, () => {
      const actual = kitCoverage(golden.traces, run.before, { exclude: ['router'] });
      const rows = run.coverage.stdout.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| ---') && !l.startsWith('| chain |')).map(cells);
      expect(actual.chains.map(c => [c.chain.join(' -> '), String(c.chain.length), String(c.traces), `${Math.round(c.share * 100)}%`,
        c.covering.map(t => t.caseId).join(', ') || '**none**', c.covering.map(t => `${t.caseId} ${t.passes}/${t.reps}`).join(', ') || '-'])).toEqual(rows);
      expect(actual.traces).toBe(golden.coupling.traces);
      expect(run.coverage.stdout).toContain(`${actual.traces} traces, ${actual.tasks} eval tasks.`);
      expect(actual.status === 'gaps' ? 1 : 0).toBe(run.coverage.code);
    });
    it(`${run.path}: task-weighted score, row means, verdict and writes match Python`, () => {
      const actual = kitCompare(run.before, run.after);
      const rows = table(run.compare.stdout, 'Metric:');
      const complete = rows.find(r => r[0] === 'tasks complete')!;
      expect(complete[1]).toBe(`${(actual.before.score * actual.common.length).toFixed(1)}/${actual.common.length} (${Math.round(actual.before.score * 100)}%)`);
      expect(complete[2]).toBe(`${(actual.after.score * actual.common.length).toFixed(1)}/${actual.common.length} (${Math.round(actual.after.score * 100)}%)`);
      for (const [label, key, digits] of [['latency per task (s)', 'latency_s', 1], ['model calls per task', 'model_calls', 1], ['input tokens per task', 'in_tokens', 0], ['output tokens per task', 'out_tokens', 0]] as const) {
        const row = rows.find(r => r[0] === label)!;
        for (const [index, summary] of [[1, actual.before], [2, actual.after]] as const) {
          expect(summary[key]!.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })).toBe(row[index]);
        }
      }
      expect(actual.writesChanged.map(c => [c.caseId, c.before, c.after])).toEqual(table(run.compare.stdout, '## Writes that changed'));
      expect(['worse', 'missing_tasks'].includes(actual.status) ? 1 : 0).toBe(run.compare.code);
      expect(run.compare.stdout).toContain(actual.status === 'worse' ? '**v1 scores worse than baseline.**' : actual.status === 'holds' ? '**v1 holds.**' : 'scores the same or better overall');
    });
    it(`${run.path}: single-version estimate matches Python two-significant-digit figures`, () => {
      const estimate = kitEstimate(run.before, { reps: 2 });
      expect(run.estimate.stdout).toContain(`${estimate.tasks} tasks x 2 reps = ${estimate.tasks * 2} conversations`);
      expect(run.estimate.stdout).toContain(`${estimate.rows} measured conversations covering ${estimate.covered} of ${estimate.tasks} tasks.`);
      expect(run.estimate.stdout).toContain(`input tokens: about ${kitRoundEstimate(estimate.input.likely!)}`);
      expect(run.estimate.stdout).toContain(`output tokens: about ${kitRoundEstimate(estimate.output.likely!)}`);
    });
  }
  it('does not let missing candidate tasks or aggregate improvements hide regressions', () => {
    const row = (id: string, score: number): FoldingKitResult => ({ prompt_id: id, grade: { pass: score } });
    expect(kitCompare([row('a', 1), row('b', 0)], [row('a', 1)]).status).toBe('missing_tasks');
    expect(kitCompare([row('a', 1), row('b', 0)], [row('a', 0), row('b', 1)]).status).toBe('mixed');
    expect(() => kitCompare([row('a', NaN)], [row('a', 1)])).toThrow('nonfinite');
    expect(() => kitCompare([row('a', 1)], [row('b', 1)])).toThrow('No common');
  });
  it('unions agents across reps only for kit coverage and never claims empty coverage', () => {
    const rows = [{ trace_id: 't', ts: 1, agent: 'a' }, { trace_id: 't', ts: 2, agent: 'b' }];
    const results: FoldingKitResult[] = [{ prompt_id: 'case', grade: { pass: 1 }, by_agent: { a: {} } }, { prompt_id: 'case', grade: { pass: 0 }, by_agent: { b: {} } }];
    expect(kitCoverage(rows, results).status).toBe('no_chains');
    expect(kitCoverage(rows, results, { minTraces: 1 }).chains[0]!.covering).toEqual([{ caseId: 'case', passes: 1, reps: 2 }]);
  });
  it('orders mixed numeric/ISO timestamps, counts each directional pair once per trace', () => {
    const rows = [ { trace_id: 't', ts: 3, agent: 'b' }, { trace_id: 't', ts: '1970-01-01T00:00:01Z', agent: 'a' },
      { trace_id: 't', ts: 2, agent: 'b' }, { trace_id: 'u', ts: 1, agent: 'a' } ];
    expect(kitCoupling(rows).pairs).toEqual([{ first: 'a', then: 'b', traces: 1, rarer: 'b', rarer_traces: 1, coupling: 1, share: .5 }]);
  });
  it('keeps probe uncertainty and rounds ties exactly as Python', () => {
    const rows = [{ prompt_id: 'a', in_tokens: 100, out_tokens: 20 }, { prompt_id: 'b', in_tokens: 1000, out_tokens: 50 }];
    expect(kitEstimate(rows, { tasks: 10, reps: 2, heavy: 3 })).toMatchObject({ input: { low: 2000, high: 20000, likely: 7400 }, output: { low: 400, high: null, likely: null } });
    expect(kitEstimate(rows.slice(0, 1), { tasks: 10 }).input).toEqual({ low: null, high: null, likely: 1000 });
    expect(kitRoundEstimate(12500)).toBe('12,000'); expect(kitRoundEstimate(13500)).toBe('14,000');
  });
});
