import { describe, expect, it } from 'vitest';
import type { TaskContext } from '../../src/core/task-types.js';
import type { ArchitectureDiagnosisInput, ArchitectureDiagnosisReport } from '../../src/core/architecture-diagnosis-types.js';
import { nativeFoldingProject } from './native.js';
import { validateFoldingProject } from '../../src/core/agent-folding-validation.js';
const when = '2026-10-29T00:00:00.000Z';
function fixture() {
  const context: TaskContext = { task: { id: 'collected:main', origin: 'collected', provenanceKnown: true, rootSessionKey: 'main', runId: null, title: 'Retained task', provider: 'codex', startedAt: when, updatedAt: when, recordedStatus: 'completed', memberCount: 2, eventCount: 5, loadedMemberCount: 2 }, members: [
    { id: 'main', name: 'Lead', role: 'main', sessionKey: 'main', parentId: null, detailLoaded: true, eventCount: 3 },
    { id: 'child', name: 'Worker', role: 'subagent', sessionKey: 'child', parentId: 'main', detailLoaded: true, eventCount: 2 },
  ], importSession: null, warnings: [] };
  const input: ArchitectureDiagnosisInput = { version: 1, taskId: context.task.id, title: context.task.title, member: 'all', origin: 'collected', revision: 'source-revision', evidence: [
    { id: 'e1', taskId: context.task.id, source: 'native_event', sessionKey: 'child', eventId: 'actual-call', captureId: null, callSequence: null, path: 'payload.arguments', excerpt: 'Read' },
  ], contexts: [], outcomes: [], handoffs: [], coverage: { context: 'unavailable', tools: 'partial', handoffs: 'unavailable', nativeEvents: 1, nativeEventTotal: 5, captures: 0, logicalCalls: 0, omitted: 4, reasons: ['native_body_limit'] } };
  const report: ArchitectureDiagnosisReport = { version: 1, taskId: input.taskId, title: input.title, member: 'all', origin: 'collected', revision: input.revision, analyzedAt: when, thresholds: { minSamples: 3, minContextTokens: 32000, minContextChars: 32768, growthRatio: 2, duplicateRatio: 0.6, toolCatalogLimit: 32, repeatedToolErrors: 2, minHandoffAnchors: 2 }, coverage: input.coverage, categories: { context_bloat: 'insufficient', tool_conflict: 'insufficient', handoff_loss: 'insufficient' }, findings: [], evidence: input.evidence, limitations: [] };
  return { context, input, report };
}
describe('native task to boundary candidates', () => {
  it('preserves exact native locator and unknown ownership without synthesizing evals or communication', () => {
    const { context, input, report } = fixture(), project = validateFoldingProject(nativeFoldingProject(context, input, report));
    expect(project.agents).toHaveLength(2); expect(project.boundaries).toHaveLength(1);
    expect(project.agents[1]).toMatchObject({ owner: null, talksToUser: null, externalOwner: null, contextNeed: 'unknown' });
    expect(project.evidence.find(ref => ref.id === 'e1')?.native).toMatchObject({ sessionKey: 'child', eventId: 'actual-call' });
    expect(project.cases).toEqual([]); expect(project.trials).toEqual([]); expect(project.traffic).toEqual([]);
    expect(project.sources[0]?.limitations.some(text => text.includes('not actual communication'))).toBe(true);
  });
  it('rejects stale or imported scope and an inventory above the bound', () => {
    const { context, input, report } = fixture(); expect(() => nativeFoldingProject(context, input, { ...report, revision: 'stale' })).toThrow();
    expect(() => nativeFoldingProject({ ...context, task: { ...context.task, origin: 'imported' } }, input, report)).toThrow();
    expect(() => nativeFoldingProject({ ...context, members: Array.from({ length: 33 }, () => context.members[0]!) }, input, report)).toThrow();
  });
});
