import { expect, it } from 'vitest';
import { redactFoldingReview, validateFoldingReviewPack, validateFoldingSemanticReview } from './agent-folding-review.js';
const pack = { boundaryId: 'x', proposed: 'fold', evidence: [{ id: 'known', text: 'retained evidence' }] };
it('bounds evidence and citations and refuses uncited claims', () => {
  const p = validateFoldingReviewPack(pack);
  for (const raw of [{ ...pack, evidence: [] }, { ...pack, evidence: [pack.evidence[0], pack.evidence[0]] }, { ...pack, evidence: [{ id: 'known', text: 'x'.repeat(2001) }] }, { ...pack, model: 'hidden' }]) expect(() => validateFoldingReviewPack(raw)).toThrow();
  const good = { text: 'Unknown [[known]]', evidenceIds: ['known'] }, review = { claims: [good], skill: good, tool: good, returnStructure: good };
  expect(validateFoldingSemanticReview(review, p)).toEqual(review);
  expect(() => validateFoldingSemanticReview({ ...review, claims: [{ ...good, evidenceIds: [] }] }, p)).toThrow();
  expect(() => validateFoldingSemanticReview({ ...review, execute: true }, p)).toThrow();
});
it('redacts credentials, private paths and addresses idempotently', () => {
  const redacted = redactFoldingReview('password=secret Bearer abc /Users/person/path user@private.test 10.0.0.1');
  expect(redacted).not.toMatch(/secret|abc|person|user@|10\.0\.0\.1/); expect(redactFoldingReview(redacted)).toBe(redacted);
});
