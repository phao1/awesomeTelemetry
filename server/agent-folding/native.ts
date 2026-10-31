import { createHash } from 'node:crypto';
import type { TaskContext } from '../../src/core/task-types.js';
import type { ArchitectureDiagnosisInput, ArchitectureDiagnosisReport } from '../../src/core/architecture-diagnosis-types.js';
import type { FoldingAgent, FoldingEvidence, FoldingProject } from '../../src/core/agent-folding-types.js';

/** Convert verified task facts into an inventory to evaluate, never invented case outcomes. */
export function nativeFoldingProject(context: TaskContext, input: ArchitectureDiagnosisInput, report: ArchitectureDiagnosisReport): FoldingProject {
  if (input.taskId !== context.task.id || report.taskId !== input.taskId || report.revision !== input.revision || context.task.origin !== 'collected') throw new Error('Native folding scope changed or is unavailable.');
  if (context.members.length > 32) throw new Error('Native inventory exceeds32 members; select a narrower task scope.');
  const sourceId = 'native-retained', evidence: FoldingEvidence[] = input.evidence.map(ref => ({ id: ref.id, sourceId, path: ref.path, pointer: null,
    sha256: null, kind: 'trace', excerpt: ref.excerpt, text: null, complete: false,
    native: { taskId: ref.taskId, sessionKey: ref.sessionKey, eventId: ref.eventId, captureId: ref.captureId, callSequence: ref.callSequence } }));
  const agents: FoldingAgent[] = context.members.map(member => {
    const observedTools = [...input.contexts.filter(value => value.agentId === member.id).flatMap(value => value.tools.map(tool => tool.name)), ...input.outcomes.filter(value => value.agentId === member.id).map(value => value.name)];
    const refId = 'member-' + createHash('sha256').update(member.id).digest('hex').slice(0, 20);
    evidence.push({ id: refId, sourceId, path: `task.members[${JSON.stringify(member.id)}]`, pointer: null, sha256: null, kind: 'owner',
      excerpt: `${member.name}; role=${member.role}; parent=${member.parentId ?? 'unknown'}`, text: null, complete: false,
      native: { taskId: input.taskId, sessionKey: member.sessionKey, eventId: null, captureId: null, callSequence: null } });
    const isMain = member.role === 'main';
    return { id: member.id, name: member.name, owner: null, isMain, prompt: null, tools: [...new Set(observedTools)], invokedBy: member.parentId ? [member.parentId] : [], returns: null,
      talksToUser: null, externalOwner: null, contextNeed: 'unknown', proposed: isMain ? 'main' : 'insufficient',
      rationale: isMain ? { zh: '保留主循环；需要共享端到端任务集验证任何边界变更。', en: 'Retain the main loop; evaluate boundary changes on shared end-to-end cases.' }
        : { zh: '已观察到成员身份；是否需要独立上下文和完整交接仍待核实。先建立基线，不据父子关系决定折叠。', en: 'Member identity is observed; context isolation and handoff needs remain unverified. Build a baseline before changing a parent-child boundary.' },
      evidenceIds: [refId, ...input.evidence.filter(ref => ref.sessionKey === member.sessionKey).slice(0, 7).map(ref => ref.id)] };
  });
  const memberIds = new Set(agents.map(agent => agent.id));
  const boundaries = context.members.filter(member => member.parentId && memberIds.has(member.parentId) && member.role !== 'main').map(member => ({
    id: 'native-boundary-' + createHash('sha256').update(member.id).digest('hex').slice(0, 20), fromAgentId: member.parentId!, targetAgentIds: [member.id], proposed: 'insufficient' as const,
    title: { zh: member.name, en: member.name }, rationale: agents.find(agent => agent.id === member.id)!.rationale,
    requirements: ['Confirm ownership, dialogue and independent-context need.', 'Provide replayable task inputs and independent completion checks.', 'Collect baseline and one-boundary comparison including neighboring tasks.'],
    evidenceIds: agents.find(agent => agent.id === member.id)!.evidenceIds,
  }));
  return { version: 1, kind: 'agent-folding-project', id: 'native-' + createHash('sha256').update(input.taskId + input.revision).digest('hex').slice(0, 20), title: context.task.title,
    createdAt: report.analyzedAt, sources: [{ id: sourceId, kind: 'native_telemetry', title: context.task.title, url: null, revision: input.revision, observedAt: report.analyzedAt, model: null,
      limitations: [...input.coverage.reasons, `Read ${input.coverage.nativeEvents}/${input.coverage.nativeEventTotal ?? 'unknown'} native records; ${input.coverage.captures} captures.`, 'Parent relationships establish roster, not actual communication or task correctness.', 'Observed tools are partial, not the complete callable catalog.'] }],
    agents, boundaries, cases: [], traffic: [], experiments: [], trials: [], evidence, humanDecisions: [], limitations: [
      'Native telemetry identifies candidates and evidence, not independent evaluation outcomes. No test case or success grade was synthesized.',
      'Ownership, direct dialogue, context need, prompts and return contracts require source/owner confirmation.',
      ...report.limitations.map(value => value.zh + ' / ' + value.en),
    ] };
}
