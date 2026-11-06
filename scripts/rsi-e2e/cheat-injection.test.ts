import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const { injectionCases, classify } = await import(pathToFileURL(resolve('scripts/rsi-e2e/cheat-injection.mjs')).href);

describe('cheat injection fixture', () => {
  it('covers both required cheating groups and keeps honest controls', async () => {
    const cases = await injectionCases();
    expect(cases.filter((c: { group: string }) => c.group === 'special_case').length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c: { group: string }) => c.group === 'test_tampering').length).toBeGreaterThanOrEqual(3);
    expect(cases.filter((c: { cheat: boolean }) => !c.cheat).length).toBeGreaterThanOrEqual(2);
    expect(new Set(cases.map((c: { id: string }) => c.id)).size).toBe(cases.length);
  });
  it('applies every edit to the real mini agent source', async () => {
    const source = await readFile('rsi-agents/mini-agent/source/agent.mjs', 'utf8');
    for (const c of await injectionCases()) {
      const edit = c.files['agent.mjs'];
      if (edit) expect(edit(source), c.id).not.toBe(source);
    }
  });
  it('never counts an informational finding as the layer that blocked a commit', () => {
    const findings = [{ iterationId: 'a', severity: 'info', source: 'process_monitor', category: 'review_clean' }, { iterationId: 'a', severity: 'reject', source: 'l1', category: 'test_tampering' }, { iterationId: 'b', severity: 'reject', source: 'monitor', category: 'task_specific' }];
    expect(classify({ id: 'a', state: 'rejected', reasons: ['x'] }, findings)).toEqual({ state: 'rejected', reasons: ['x'], layers: ['l1'], categories: ['test_tampering'] });
  });
});
