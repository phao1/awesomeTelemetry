import { describe, expect, it } from 'vitest';
import type { RsiFinding } from '../../src/core/rsi-types.js';
import { defaultReviewSettings, isInformationalReviewFinding, MissingReviewProvider, validateReviewSettings } from './review.js';

const finding: RsiFinding = { id: 'finding', taskId: 'task', iterationId: 'iteration', level: 'L1', category: 'suspicious', severity: 'info', source: 'rule', file: null, line: null, evidence: null, at: '2026-11-07T00:00:00.000Z' };
describe('trusted review settings and gate boundary', () => {
  it('defaults to distinct optimizer/monitor families and independent settings objects', () => {
    const a = defaultReviewSettings(), b = defaultReviewSettings();
    expect(a.optimizerFamily).toBe('deepseek'); expect(a.monitorFamily).toBe('openai'); expect(a).not.toBe(b);
    expect(validateReviewSettings(a)).toEqual(a);
  });
  it('rejects matching model families before any request can start', () => {
    expect(() => validateReviewSettings({ ...defaultReviewSettings(), optimizerFamily: 'openai' })).toThrow('families must differ');
    expect(() => validateReviewSettings({ ...defaultReviewSettings(), optimizerFamily: 'anthropic', monitorFamily: 'anthropic' })).toThrow('families must differ');
  });
  it('rejects credentials in model URLs, unknown settings and invalid finite limits', () => {
    expect(() => validateReviewSettings({ ...defaultReviewSettings(), monitorBaseUrl: 'http://user:secret@localhost/v1' })).toThrow();
    expect(() => validateReviewSettings({ ...defaultReviewSettings(), adversarialMinValid: 4 })).toThrow();
    expect(() => validateReviewSettings({ ...defaultReviewSettings(), auditSampleRate: Number.NaN })).toThrow();
    expect(() => validateReviewSettings({ ...defaultReviewSettings(), timeoutMs: 0 })).toThrow();
    expect(() => validateReviewSettings({ ...defaultReviewSettings(), apiKey: 'never allowed' } as ReturnType<typeof defaultReviewSettings>)).toThrow();
  });
  it('excludes only the three trusted info sources, never old or non-info findings', () => {
    for (const source of ['patch_scan', 'process_monitor', 'degraded_monitor'] as const) {
      expect(isInformationalReviewFinding({ ...finding, source })).toBe(true);
      for (const severity of ['hold', 'reject'] as const) expect(isInformationalReviewFinding({ ...finding, source, severity })).toBe(false);
    }
    for (const source of ['rule', 'monitor', 'human', 'calibration'] as const) expect(isInformationalReviewFinding({ ...finding, source })).toBe(false);
  });
  it('keeps unavailable reviews missing', async () => {
    expect(await new MissingReviewProvider().review()).toEqual({ monitor: { status: 'missing' }, adversarial: { status: 'missing' } });
  });
});
