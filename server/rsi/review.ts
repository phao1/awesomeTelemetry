import type { RsiFinding, RsiIteration, RsiReview, RsiTask } from '../../src/core/rsi-types.js';

export interface ReviewSettings {
  optimizerFamily: string; monitorFamily: string; monitorBaseUrl: string; monitorModel: string;
  timeoutMs: number; maxOutputTokens: number; adversarialQuestions: number;
  adversarialMinValid: number; adversarialRegressionMin: number; auditSampleRate: number;
  calibrationDetectionMin: number; calibrationFalsePositiveMax: number;
}
export function defaultReviewSettings(): ReviewSettings {
  return { optimizerFamily: 'deepseek', monitorFamily: 'openai', monitorBaseUrl: 'http://127.0.0.1:4317/v1',
    monitorModel: 'gpt-6.1-sol', timeoutMs: 120000, maxOutputTokens: 4096,
    adversarialQuestions: 3, adversarialMinValid: 2, adversarialRegressionMin: 2,
    auditSampleRate: .1, calibrationDetectionMin: .8, calibrationFalsePositiveMax: .1 };
}
export function validateReviewSettings(value: ReviewSettings): ReviewSettings {
  const defaults = defaultReviewSettings();
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== Object.keys(defaults).sort().join()) throw new Error('Invalid reviews settings');
  for (const key of ['optimizerFamily', 'monitorFamily'] as const) if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value[key])) throw new Error(`Invalid reviews.${key}`);
  if (value.optimizerFamily === value.monitorFamily) throw new Error('Optimizer and monitor model families must differ');
  const url = new URL(value.monitorBaseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid reviews.monitorBaseUrl');
  if (!value.monitorModel || value.monitorModel.length > 512 || [...value.monitorModel].some(c => c.charCodeAt(0) < 32)) throw new Error('Invalid reviews.monitorModel');
  for (const key of ['timeoutMs', 'maxOutputTokens', 'adversarialQuestions', 'adversarialMinValid', 'adversarialRegressionMin'] as const) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1) throw new Error(`Invalid reviews.${key}`);
  }
  if (value.adversarialQuestions > 100 || value.adversarialMinValid > value.adversarialQuestions || value.adversarialRegressionMin > value.adversarialQuestions) throw new Error('Invalid adversarial limits');
  for (const key of ['auditSampleRate', 'calibrationDetectionMin', 'calibrationFalsePositiveMax'] as const) {
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) throw new Error(`Invalid reviews.${key}`);
  }
  return value;
}
export interface ReviewResult { monitor: RsiReview; adversarial: RsiReview }
export interface ReviewProvider {
  review(task: RsiTask, iteration: RsiIteration, signal?: AbortSignal): Promise<ReviewResult>;
}
export class MissingReviewProvider implements ReviewProvider {
  review(): Promise<ReviewResult> { return Promise.resolve({ monitor: { status: 'missing' }, adversarial: { status: 'missing' } }); }
}
/** These sources are minted only by trusted P5 code, never accepted as optimizer evidence. */
export function isInformationalReviewFinding(finding: RsiFinding): boolean {
  return finding.severity === 'info' && ['patch_scan', 'process_monitor', 'degraded_monitor'].includes(finding.source);
}
