import type { FoldingAction } from './agent-folding-types.js';
export interface FoldingReviewPack { boundaryId: string; proposed: FoldingAction; evidence: Array<{ id: string; text: string }> }
export interface FoldingReviewStatement { text: string; evidenceIds: string[] }
export interface FoldingSemanticReview { claims: FoldingReviewStatement[]; skill: FoldingReviewStatement; tool: FoldingReviewStatement; returnStructure: FoldingReviewStatement }
export interface FoldingReviewPreview { pack: FoldingReviewPack; digest: string }
export interface FoldingReviewResult { model: string; usage: { inputTokens: number; outputTokens: number }; review: FoldingSemanticReview | null; rejection: string | null }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join()) throw new Error('Invalid review shape');
  return value as Record<string, unknown>;
}
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
export function redactFoldingReview(text: string): string {
  return text.replace(/(?:sk-|key-)[a-zA-Z0-9_-]{16,}/g, '[credential]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [credential]')
    .replace(/((?:api[_-]?key|password|secret|token)\s*[=:]\s*)[^\s,;"']+/gi, '$1[credential]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:\/(?:Users|home|private)\/|[A-Z]:\\Users\\)[^\s"'<>]+/g, '[private path]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]');
}
export function validateFoldingReviewPack(raw: unknown): FoldingReviewPack {
  const p = object(raw, ['boundaryId', 'proposed', 'evidence']);
  if (!id(p.boundaryId) || !['main', 'fold', 'merge', 'as_tool', 'keep', 'insufficient'].includes(String(p.proposed)) || !Array.isArray(p.evidence) || p.evidence.length < 1 || p.evidence.length > 20) throw new Error('Invalid review selection');
  const evidence = p.evidence.map(value => { const e = object(value, ['id', 'text']); if (!id(e.id) || typeof e.text !== 'string' || !e.text.trim() || e.text.length > 2000) throw new Error('Invalid review evidence'); return { id: e.id, text: redactFoldingReview(e.text) }; });
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) throw new Error('Duplicate evidence IDs');
  const pack = { boundaryId: p.boundaryId, proposed: p.proposed as FoldingAction, evidence };
  if (new TextEncoder().encode(JSON.stringify(pack)).length > 65536) throw new Error('Review pack exceeds 64KiB');
  return pack;
}
export function validateFoldingSemanticReview(raw: unknown, pack: FoldingReviewPack): FoldingSemanticReview {
  const r = object(raw, ['claims', 'skill', 'tool', 'returnStructure']), ids = new Set(pack.evidence.map(e => e.id));
  const statement = (raw: unknown): FoldingReviewStatement => { const s = object(raw, ['text', 'evidenceIds']);
    if (typeof s.text !== 'string' || !s.text.trim() || s.text.length > 8000 || !Array.isArray(s.evidenceIds) || s.evidenceIds.length < 1 || s.evidenceIds.length > 20 || new Set(s.evidenceIds).size !== s.evidenceIds.length || s.evidenceIds.some(v => typeof v !== 'string' || !ids.has(v))) throw new Error('Invalid or invented citation');
    for (const match of s.text.matchAll(/\[\[([^\]]+)\]\]/g)) if (!ids.has(match[1]!)) throw new Error('Invented inline citation');
    return { text: redactFoldingReview(s.text), evidenceIds: s.evidenceIds as string[] };
  };
  if (!Array.isArray(r.claims) || !r.claims.length || r.claims.length > 12) throw new Error('Invalid claims');
  return { claims: r.claims.map(statement), skill: statement(r.skill), tool: statement(r.tool), returnStructure: statement(r.returnStructure) };
}
