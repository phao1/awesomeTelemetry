import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyKitInventory, buildKitArtifacts, kitLines, parseKitInventory, parseKitPlan, parseKitResults } from './agent-folding-interchange.js';
import { kitCompare, kitCoupling } from './agent-folding-kit.js';
import { validateFoldingProject } from './agent-folding-validation.js';
import golden from './__fixtures__/agent-folding-kit-golden.json';
const project = () => validateFoldingProject(JSON.parse(readFileSync('data/agent-folding/support-desk-project.json', 'utf8')));
describe('r4 P4 kit interchange', () => {
  it('exports pinned recordings into Python-compatible traces/results without answers', () => {
    const p = project(), files = buildKitArtifacts(p);
    const traces = [...kitLines(files.find(f => f.path === 'traces.jsonl')!.content)].map(l => JSON.parse(l));
    const coupling = kitCoupling(traces);
    expect(coupling.pairs).toEqual(golden.coupling.pairs);
    for (const e of p.experiments) {
      const before = parseKitResults(kitLines(files.find(f => f.path === `results/${e.id}/${e.baselineVariantId}/results.jsonl`)!.content));
      const after = parseKitResults(kitLines(files.find(f => f.path === `results/${e.id}/${e.candidateVariantId}/results.jsonl`)!.content));
      expect(kitCompare(before, after).status).toBe(e.id === 'returns-fold' ? 'mixed' : 'worse');
      expect(before.every(r => !('answer' in r) && !('prompt' in r))).toBe(true);
    }
  });
  it('roundtrips inventory and imports the original kit human columns', () => {
    const p = project(), snapshot = structuredClone(p);
    const exported = buildKitArtifacts(p).find(f => f.path === 'inventory.tsv')!;
    const restored = applyKitInventory(p, parseKitInventory(exported.content));
    expect(restored.project.agents.map(a => a.proposed)).toEqual(p.agents.map(a => a.proposed));
    const imported = applyKitInventory(p, parseKitInventory(readFileSync('data/agent-folding/single-agent-loop-kit/examples/support-desk/example-run/plan/inventory.tsv', 'utf8')));
    expect(imported.project.agents.find(a => a.id === 'claims')).toMatchObject({ talksToUser: true, proposed: 'keep' });
    expect(imported.evalsByAgent.orders).toContain('t01');
    expect(p).toEqual(snapshot);
    expect(imported.project.sources).toEqual(p.sources);
  });
  it('parses progress as inert declarations and keeps unknown results unknown', () => {
    expect(parseKitPlan('# Plan\n- [x] reviewed\n- [ ] pending\n<script>execute()</script>')).toEqual([{ text: 'reviewed', done: true }, { text: 'pending', done: false }]);
    const rows = parseKitResults(kitLines('{"case_id":"one","in_tokens":null,"status":"error","answer":"secret"}\n'));
    expect(rows).toEqual([{ prompt_id: 'one', status: 'error', in_tokens: null }]);
    expect(() => kitCompare(rows, rows)).toThrow('No common');
  });
  it('rejects malformed, oversized and invalid rows and unknown inventory targets', () => {
    expect(() => parseKitResults(['{"prompt_id":"x","in_tokens":-1}'])).toThrow('metric');
    expect(() => parseKitResults(['{"prompt_id":"x","grade":{"pass":"NaN"}}'])).toThrow('grade');
    expect(() => parseKitResults(Array(4001).fill('{"prompt_id":"x"}'))).toThrow('4000');
    expect(() => parseKitResults([' '.repeat(8 * 1024 * 1024 + 1)])).toThrow('8MiB');
    expect(() => parseKitInventory('agent\tverdict\nx\tfold')).toThrow('column');
    expect(() => applyKitInventory(project(), [{ agent: 'missing', owner: null, talksToUser: null, action: 'fold', mergeWith: null, evals: null }])).toThrow('Unknown');
    expect(() => applyKitInventory(project(), [{ agent: 'router', owner: null, talksToUser: null, action: 'fold', mergeWith: null, evals: null }])).toThrow('Main');
  });
});
