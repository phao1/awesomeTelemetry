import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFingerprintDictionary, scanDiff } from '../../src/core/rsi-l1-rules.js';
import type { RsiQuestionMetadata } from '../../src/core/rsi-types.js';

const bank = fileURLToPath(new URL('../../rsi-bank/tasks/', import.meta.url));
const ids = (await readdir(bank)).sort();
const metadata: RsiQuestionMetadata[] = await Promise.all(ids.map(async id => JSON.parse(await readFile(join(bank, id, 'meta.json'), 'utf8')) as RsiQuestionMetadata));
const dictionary = buildFingerprintDictionary(metadata);
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const diff = (content: string, path = 'src/controller.ts') => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${content}\n`;

describe('RSI bank dictionary against the real P1 rules', () => {
  it('builds a nonempty deterministic corpus dictionary for thirty distinct tasks', () => {
    expect(metadata).toHaveLength(30);
    expect(dictionary.entries.length).toBeGreaterThan(30);
    expect(buildFingerprintDictionary([...metadata].reverse())).toEqual(dictionary);
    expect(new Set(metadata.map(q => q.questionId)).size).toBe(30);
  });
  it.each([
    ['refactor', 'const result = records.filter(record => record.active);'],
    ['logging', 'console.info("Refresh completed", { elapsedMs });'],
    ['prompt wording', 'Explain the change clearly and keep the public API stable.'],
    ['Chinese prompt wording', '先阅读相关代码，完成后说明验证结果。'],
  ])('does not flag benign %s', (_label, text) => {
    expect(scanDiff(diff(text, text.includes('Explain') ? 'prompts/reviewer.md' : 'src/controller.ts'), dictionary)).toEqual([]);
  });
  for (const question of metadata) {
    it(`${question.questionId}: retains and catches the ID, every hidden name and rare diagnostic`, () => {
      for (const [kind, values] of [
        ['questionId', [question.questionId]], ['testName', question.testNames], ['rareString', question.rareStrings],
      ] as const) {
        expect(values.length).toBeGreaterThan(0);
        for (const value of values) {
          expect(dictionary.entries.some(e => e.value === normalize(value) && e.questionIds.includes(question.questionId) && e.kinds.includes(kind))).toBe(true);
          const findings = scanDiff(diff(`const injected = ${JSON.stringify(value)};`), dictionary);
          expect(findings.some(f => f.category === 'task_fingerprint' && f.severity === 'reject')).toBe(true);
          expect(scanDiff(diff(value, 'prompts/reviewer.md'), dictionary).some(f => f.category === 'task_fingerprint')).toBe(true);
        }
      }
    });
  }
});
