import { describe, expect, it } from 'vitest';

const { flagsFor } = await import(new URL('./blind-trial.mjs', import.meta.url).href);

describe('blind trial arguments', () => {
  it('needs a bank, a model and at least one question, and defaults to low effort', () => {
    expect(flagsFor(['--bank', 'rsi-bank-hard', '--model', 'm', 'a', 'b'])).toMatchObject({ bank: 'rsi-bank-hard', model: 'm', effort: 'low', ids: ['a', 'b'] });
    expect(flagsFor(['a', '--model', 'm', '--bank', 'x', '--effort', 'high'])).toMatchObject({ effort: 'high', ids: ['a'] });
    expect(() => flagsFor(['--bank', 'x', '--model', 'm'])).toThrow('Usage');
    expect(() => flagsFor(['--model', 'm', 'a'])).toThrow('Usage');
    expect(() => flagsFor(['--bank', 'x', '--model', 'm', '--unknown', 'y', 'a'])).toThrow('Usage');
    expect(() => flagsFor(['--bank', 'x', '--model'])).toThrow('Usage');
  });
});
