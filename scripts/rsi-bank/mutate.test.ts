import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const mutation = await import(new URL('./mutate.mjs', import.meta.url).href);
const runner = await import(new URL('./validate.mjs', import.meta.url).href);

describe('mutation generation', () => {
  it('targets only new-side changed lines across files and hunks', () => {
    const changes = mutation.changedLines('diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n end\n@@ -10 +10,2 @@\n-old\n+one\n+two\ndiff --git a/b.py b/b.py\n--- a/b.py\n+++ b/b.py\n@@ -1 +1 @@\n-old\n+fixed\n');
    expect([...changes.get('a.py')]).toEqual([2, 10, 11]);
    expect([...changes.get('b.py')]).toEqual([1]);
  });
  it.each([
    ['a <= b', 'a < b'], ['a > b', 'a >= b'], ['a === b', 'a !== b'],
    ['a && b', 'a || b'], ['a and b', 'a or b'], ['x // width', 'x / width'], ['!enabled', 'enabled'], ['i++', 'i--'], ['return 3;', 'return 4;'],
  ])('mutates %s to include %s', (source, target) => {
    expect(mutation.lineMutations(source).map((m: { text: string }) => m.text)).toContain(target);
  });
  it('preserves literals and unselected lines, deduplicates changes and includes statement deletion', () => {
    const source = 'return "a <= 10 and b";\nreturn x <= 1;\n';
    const mutants = mutation.mutations(source, new Set([2]));
    expect(mutants.length).toBeGreaterThan(2);
    expect(new Set(mutants.map((m: { source: string }) => m.source)).size).toBe(mutants.length);
    expect(mutants.every((m: { source: string }) => m.source.startsWith('return "a <= 10 and b";'))).toBe(true);
    expect(mutants.some((m: { kind: string }) => m.kind === 'delete statement')).toBe(true);
    expect(mutation.lineMutations('if (a === b) { return value; }').some((m: { kind: string }) => m.kind === 'delete statement')).toBe(false);
    expect(mutation.lineMutations('const label = "a <= 10 and b";').filter((m: { kind: string }) => m.kind !== 'delete statement')).toEqual([]);
  });
  it('the real hidden suite kills every valid page-window mutant', async () => {
    const { questions } = await runner.readBank();
    const question = questions.find((q: { id: string }) => q.id === 'rsi-page-window');
    const space = await runner.workspace(question, true);
    try {
      const target = join(space.work, 'logic.mjs');
      const source = await readFile(target, 'utf8');
      const changes = mutation.changedLines(await readFile(join(question.directory, 'reference.patch'), 'utf8'));
      let killed = 0;
      for (const mutant of mutation.mutations(source, changes.get('logic.mjs'))) {
        await writeFile(target, mutant.source);
        const report = await runner.runTests(question, space);
        expect(report.passed).toBe(false);
        if (report.complete) killed++;
      }
      expect(killed).toBeGreaterThan(0);
    } finally { await space.cleanup(); }
  });
});
