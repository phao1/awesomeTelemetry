import { analyzeFoldingProject } from '../../src/core/agent-folding-analysis.js';
import { FOLDING_MAX_BYTES, validateFoldingProject } from '../../src/core/agent-folding-validation.js';
import type { FoldingAnalysis, FoldingArtifact, FoldingProject } from '../../src/core/agent-folding-types.js';

const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const purpose = (zh: string, en: string) => ({ zh, en });
const slug = (value: string, index: number): string => `${index + 1}-${value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').slice(0, 80) || 'boundary'}`;

/** Produces inert review files only. This function never writes to an Agent repository. */
export function buildFoldingArtifacts(value: FoldingProject, suppliedAnalysis?: FoldingAnalysis): FoldingArtifact[] {
  const project = validateFoldingProject(value), analysis = analyzeFoldingProject(project);
  if (suppliedAnalysis !== undefined && JSON.stringify(suppliedAnalysis) !== JSON.stringify(analysis)) {
    throw new TypeError('Folding artifacts require current project analysis');
  }
  const artifacts: FoldingArtifact[] = [
    { path: 'README.md', purpose: purpose('审阅入口与来源限制', 'Review entry point and source limitations'), content: `# Agent boundary review\n\n${project.title.replace(/[\r\n]/gu, ' ')}\n\nThese files are proposals for human review. Nothing has been applied to an Agent repository. Human adoption notes do not replace measurements or regression blockers.\n\nSources are preserved in inventory.json, including reported provenance, revision, and limitations. User imports cannot authenticate official or native origins. Fictional tasks, synthetic traffic, offline smoke, and measured model runs remain distinct. Offline smoke has no grade.\n\nReview analysis.json and decision-log.json first, then the shared and confirmation cases, boundary plans, skill/tool specifications, and upkeep ownership. A task is one independent input; checks are assertions within it.\n\nNo generated recipe has been executed. A measured token budget is checked after a response and cannot guarantee an exact maximum API bill.\n` },
    { path: 'inventory.json', purpose: purpose('逐 Agent 审计与真实来源清单', 'Per-agent audit and retained source inventory'), content: pretty({
      projectId: project.id, agents: project.agents, boundaries: project.boundaries, sources: project.sources,
      evidence: project.evidence.map(({ id, sourceId, path, pointer, sha256, kind, complete, native }) => ({ id, sourceId, path, pointer, sha256, kind, complete, native })), limitations: project.limitations,
    }) },
    { path: 'analysis.json', purpose: purpose('逐边界实测结论与回归', 'Measured per-boundary disposition and regressions'), content: pretty(analysis) },
    { path: 'decision-log.json', purpose: purpose('独立保存人工决定和测量结论', 'Keep human decisions separate from measurements'), content: pretty({
      measured: analysis.decisions, human: project.humanDecisions, note: 'Human decisions cannot overwrite measured regressions or source limitations.',
    }) },
    { path: 'eval/tasks.shared.json', purpose: purpose('独立任务与共享检查集', 'Independent tasks and shared checks'), content: pretty(project.cases.filter(c => c.split === 'train')) },
    { path: 'eval/tasks.confirmation.json', purpose: purpose('独立最终确认集', 'Independent final-confirmation set'), content: pretty(project.cases.filter(c => c.split === 'confirmation')) },
    { path: 'estimates.json', purpose: purpose('已有基线度量与未来执行估算限制', 'Retained baseline metrics and future-run estimate limits'), content: pretty({
      recordedExperiments: analysis.experiments.map(experiment => ({ experimentId: experiment.experimentId,
        baselineMetrics: Object.fromEntries(Object.entries(experiment.metrics).map(([key, value]) => [key, value.baseline])),
        expectedTrials: experiment.baseline.expected, knownGrades: experiment.baseline.known })),
      nextRun: { model: null, modelCalls: null, inputTokens: null, outputTokens: null, basis: 'Requires a concrete reviewed plan and a comparable measured baseline for each selected task.' },
      limitations: ['Candidate and skill-off costs can differ from baseline.', 'Measured token budgets include nested calls and are checked after responses; they cannot guarantee an exact maximum bill.', 'No model or tool was executed to create this artifact.'],
    }) },
    { path: 'structured-result.schema.json', purpose: purpose('子 Agent 结构化交付物契约', 'Structured subagent deliverable contract'), content: pretty({
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
      required: ['conclusion', 'evidence', 'actions_taken', 'confidence', 'caveats'], properties: {
        conclusion: { type: 'string', minLength: 1 }, evidence: { type: 'array', items: { type: 'string' } },
        actions_taken: { type: 'array', items: { type: 'object', required: ['name', 'arguments'], properties: { name: { type: 'string' }, arguments: { type: 'object' } }, additionalProperties: false } },
        confidence: { enum: ['high', 'medium', 'low'] }, caveats: { type: 'array', items: { type: 'string' } },
      }, $comment: 'A parse failure or missing evidence must preserve a low-confidence invalid-result state. The main loop independently verifies terminal facts; this schema is not a fabricated verifier.',
    }) },
    { path: 'upkeep.md', purpose: purpose('贡献、所有者与持续验证责任', 'Contribution, ownership, and continuing verification'), content: `# Upkeep responsibilities\n\nInventory owners are recorded as supplied; null means unknown. Assign an owner before adopting a protected or externally controlled boundary.\n\n- Keep one source of truth for tool names, schemas, permission gates, and preconditions. Direct tools must independently reject bypass attempts.\n- Review each proposed skill and its original prompt. Preserve constraints, required references, and lookup instructions.\n- Change one boundary per experiment. Keep all other roles, fixed cases, grader, model/configuration, runner, environment, and budgets controlled.\n- Run relevant neighboring tasks, terminal-chain assertions, confirmation cases, and a separate skill-off ablation. A pass-to-fail in any task blocks automatic adoption.\n- Preserve complete action arguments, route sequence, nested usage, and source pointers. Do not invent historic timings or full result bodies.\n- Recheck these artifacts after tool/schema/policy/model changes. Record human decisions separately and rerun regressions before adoption.\n` },
    { path: 'recipes.md', purpose: purpose('显式命令行集成步骤', 'Explicit CLI integration recipes'), content: `# CLI integration recipes\n\nCreate and review a strict agent-folding-plan JSON first. Each plan targets one declared boundary and explicitly lists cases, repetitions, current model, and budgets. Replace PLAN.json and NEW_OUTPUT_DIRECTORY with reviewed local paths.\n\nValidate and estimate only (no execution):\n\n\`\`\`sh\nnode bin/agent-folding.js PLAN.json\n\`\`\`\n\nRun the fixed offline fixture explicitly (unscored):\n\n\`\`\`sh\nnode bin/agent-folding.js PLAN.json --execute --output NEW_OUTPUT_DIRECTORY\n\`\`\`\n\nA real Anthropic plan additionally requires the explicit paid flag and ANTHROPIC_API_KEY in the process environment; never put credentials in plan files or command arguments:\n\n\`\`\`sh\nnode bin/agent-folding.js PLAN.json --execute --allow-paid --output NEW_OUTPUT_DIRECTORY\n\`\`\`\n\nExternal plans use argv arrays with an independent evaluator and isolated workspaces. These recipes do not claim live API verification. Claude Code /claude-api commands, API Skills/code execution, Message Batches, and tool search are separate integrations; no build-eval or hillclimb HTTP API is implied.\n` },
  ];
  project.boundaries.forEach((boundary, index) => {
    const name = slug(boundary.id, index), targets = project.agents.filter(agent => boundary.targetAgentIds.includes(agent.id));
    const decision = analysis.decisions.find(decision => decision.boundaryId === boundary.id)!;
    artifacts.push({ path: `plans/${name}.json`, purpose: purpose('单一边界迁移审阅计划', 'Single-boundary migration review plan'), content: pretty({
      boundary, measuredDisposition: decision, preserveOtherAgents: project.agents.filter(agent => !boundary.targetAgentIds.includes(agent.id)).map(agent => agent.id),
      requiredBeforeAdoption: ['Verify owner/direct-dialogue contract.', 'Review exact prompt/tool/skill changes.', 'Check all relevant neighboring tasks and ordered terminal facts.',
        'At least three complete comparable real repetitions.', 'Independent confirmation and required skill-off ablation.', 'No task may regress from pass to fail.'],
      rollback: 'Restore the prior boundary and controlled revisions; retain independent verification and all measured regressions.',
    }) });
    artifacts.push({ path: `skills/${name}/SKILL.md`, purpose: purpose('待审阅的渐进披露技能草案', 'Reviewable progressive-disclosure skill draft'), content: `# Boundary skill draft\n\nThis is an unapplied draft. Review ownership, original instructions, return contracts, and safety gates before using it. The proposed action is ${boundary.proposed}; the measured disposition is ${decision.status}. Protected boundaries must preserve their dialogue or external-control contract.\n\nLoad this skill by an explicit name only when its task is relevant. Retrieve original material on demand rather than copying every specialist prompt into the main loop. Return evidence and caveats; keep main-loop verification independent.\n\nOriginal recorded specialist contracts (JSON, null remains unknown):\n\n\`\`\`json\n${pretty(targets.map(agent => ({ id: agent.id, owner: agent.owner, prompt: agent.prompt, tools: agent.tools, returns: agent.returns, contextNeed: agent.contextNeed, evidenceIds: agent.evidenceIds })))}\`\`\`\n` });
    artifacts.push({ path: `tools/${name}.json`, purpose: purpose('工具入口、前提与待补 Schema', 'Tool entry points, preconditions, and missing schemas'), content: pretty({
      boundaryId: boundary.id, tools: targets.flatMap(agent => agent.tools.map(name => {
        const definition = agent.toolDefinitions?.find(tool => tool.name === name);
        return { name, originalAgentId: agent.id, description: definition?.description ?? null,
          inputSchema: definition?.inputSchema ?? null, writes: definition?.writes ?? null, preconditions: definition?.preconditions ?? [],
          evidenceIds: definition?.evidenceIds ?? [], schemaStatus: definition?.inputSchema == null ? 'not_retained_in_inventory' : 'retained_contract',
          requiredReview: ['Review the retained real schema; null remains unknown.', 'Enforce permissions and preconditions inside the tool runtime.', 'Test rejected bypass attempts independently of the model.'] };
      })),
      structuredResultSchema: '../structured-result.schema.json', evidenceIds: boundary.evidenceIds,
    }) });
  });
  if (new TextEncoder().encode(JSON.stringify(artifacts)).length > FOLDING_MAX_BYTES) throw new RangeError('Folding artifacts exceed the 8MiB export budget');
  return artifacts;
}
