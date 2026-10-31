import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ArchitectureReview } from './ArchitectureReview.js';
import { validateFoldingReviewPack } from '../../core/agent-folding-review.js';
import { DEFAULT_FOLDING_THRESHOLDS } from '../../core/agent-folding-rules.js';
import type { FoldingProject, FoldingRuleDecision } from '../../core/agent-folding-types.js';
it('makes only status reads on mount and requires explicit preview then send; removal invalidates consent', async () => {
  const calls: string[] = [], host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url); const body = url.endsWith('/status') ? { anthropicConfigured: true, modelConfigured: true, model: 'LOCAL_TEST', paidExecution: 'cli_only' }
      : url.endsWith('/preview') ? { pack: validateFoldingReviewPack(JSON.parse(String(init?.body))), digest: 'preview-test' }
      : { model: 'LOCAL_TEST', usage: { inputTokens: 12, outputTokens: 4 }, review: null, rejection: 'Model output rejected' };
    return { ok: true, text: async () => JSON.stringify(body) } as Response;
  }));
  const project: FoldingProject = { version: 1, kind: 'agent-folding-project', id: 'test', title: 'test', createdAt: '2026-10-30T00:00:00.000Z', agents: [], sources: [], boundaries: [], traffic: [], cases: [], experiments: [], trials: [], humanDecisions: [], limitations: [], evidence: [{ id: 'e1', sourceId: 'test', path: 'fixture', pointer: null, sha256: null, kind: 'trace', excerpt: 'sk-abcdefghijklmnopqrstuvwxyz', text: null, complete: true, native: null }] };
  const decision: FoldingRuleDecision = { agentId: 'boundary', action: 'insufficient', mergeWith: null, confidence: 'low', sampleCount: 1, thresholds: { ...DEFAULT_FOLDING_THRESHOLDS }, reasons: [], counterEvidence: [], evidenceIds: ['e1'], ownerQuestions: [] };
  const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
  try {
    await act(async () => { root.render(<ArchitectureReview project={project} decision={decision} />); });
    expect(calls).toEqual(['/api/agent-folding/status']); expect(host.textContent).not.toContain('abcdefghijklmnopqrstuvwxyz'); expect(button('发送所示').disabled).toBe(true);
    await act(async () => button('预览最终').click()); expect(calls.filter(p => p.endsWith('/review'))).toHaveLength(0); expect(button('发送所示').disabled).toBe(false);
    await act(async () => button('发送所示').click()); expect(calls.filter(p => p.endsWith('/review'))).toHaveLength(1); expect(host.textContent).toContain('输入 12 / 输出 4');
    await act(async () => button('移除此证据').click()); expect(button('发送所示').disabled).toBe(true); expect(host.textContent).not.toContain('最终发送内容');
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
