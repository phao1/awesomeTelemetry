import type { RsiIteration, RsiReview, RsiTask } from '../../src/core/rsi-types.js';

export interface ReviewResult { monitor: RsiReview; adversarial: RsiReview }
export interface ReviewProvider {
  review(task: RsiTask, iteration: RsiIteration, signal?: AbortSignal): Promise<ReviewResult>;
}
export class MissingReviewProvider implements ReviewProvider {
  review(): Promise<ReviewResult> { return Promise.resolve({ monitor: { status: 'missing' }, adversarial: { status: 'missing' } }); }
}
