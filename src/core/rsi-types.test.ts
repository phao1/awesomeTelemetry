import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RSI_ITERATION_STATES, RSI_PHASES, RSI_TASK_STATES } from './rsi-types.js';
import type { RsiEvaluation, RsiLedgerEntry, RsiRun, RsiTask } from './rsi-types.js';

describe('RSI-002 authoritative types', () => {
  it('adopts the complete contract declaration block verbatim', () => {
    const contract = readFileSync('openspec/contracts/rsi.md', 'utf8').split('### P5 authoritative runtime declarations\n')[1]!.split('```ts\n')[1]!.split('```')[0]!;
    const source = readFileSync('src/core/rsi-types.ts', 'utf8').split('\n').slice(1).join('\n');
    expect(source).toBe(contract);
  });
  it('defines all task/iteration states, six phases and three outcomes', () => {
    expect(RSI_TASK_STATES).toHaveLength(7); expect(RSI_ITERATION_STATES).toHaveLength(10); expect(RSI_PHASES).toHaveLength(6);
    expectTypeOf<RsiRun['outcome']>().toEqualTypeOf<'pass' | 'fail' | 'infra_error'>();
    expectTypeOf<RsiTask['delta']>().toEqualTypeOf<number | null>();
    expectTypeOf<RsiEvaluation['score']>().toEqualTypeOf<number | null>();
    expectTypeOf<RsiLedgerEntry['event']>().toEqualTypeOf<'task_put' | 'iteration_put' | 'evaluation_put' | 'run_put' | 'finding_put' | 'decision_put' | 'instruction_put' | 'queue_put'>();
  });
});
