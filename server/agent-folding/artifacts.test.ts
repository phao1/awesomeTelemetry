import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFoldingArtifacts } from './artifacts.js';
import { analyzeFoldingProject } from '../../src/core/agent-folding-analysis.js';
import { importFoldingProject, validateFoldingProject } from '../../src/core/agent-folding-validation.js';

const official = () => validateFoldingProject(JSON.parse(readFileSync('data/agent-folding/support-desk-project.json', 'utf8')));
describe('AF-005 reviewable migration artifacts', () => {
  it('exports real per-agent inventory, decisions, shared/confirmation tasks and unapplied boundary artifacts', () => {
    const project = official(), before = structuredClone(project), artifacts = buildFoldingArtifacts(project);
    expect(artifacts.map(artifact => artifact.path)).toEqual(expect.arrayContaining(['README.md', 'inventory.json', 'analysis.json', 'decision-log.json',
      'eval/tasks.shared.json', 'eval/tasks.confirmation.json', 'structured-result.schema.json', 'upkeep.md', 'recipes.md']));
    expect(artifacts.some(artifact => artifact.path.startsWith('skills/') && artifact.path.endsWith('/SKILL.md'))).toBe(true);
    expect(artifacts.some(artifact => artifact.path.startsWith('tools/'))).toBe(true);
    expect(artifacts.filter(artifact => artifact.path.startsWith('plans/'))).toHaveLength(project.boundaries.length);
    const inventory = JSON.parse(artifacts.find(artifact => artifact.path === 'inventory.json')!.content);
    expect(inventory.agents).toHaveLength(7); expect(inventory.evidence).toHaveLength(project.evidence.length);
    expect(artifacts.find(artifact => artifact.path === 'README.md')!.content).toContain('Nothing has been applied');
    expect(project).toEqual(before);
  });
  it('preserves honest source limits, unknown schemas and human notes without overwriting regressions', () => {
    const project = importFoldingProject(official()); project.agents.forEach(agent => { delete agent.toolDefinitions; });
    const artifacts = buildFoldingArtifacts(project);
    const inventory = JSON.parse(artifacts.find(artifact => artifact.path === 'inventory.json')!.content);
    expect(inventory.sources.every((source: { kind: string }) => source.kind === 'user_import')).toBe(true);
    const log = JSON.parse(artifacts.find(artifact => artifact.path === 'decision-log.json')!.content);
    expect(log.human.some((decision: { decidedAt: string | null }) => decision.decidedAt === null)).toBe(true);
    expect(log.measured.some((decision: { status: string }) => decision.status === 'regression')).toBe(true);
    expect(artifacts.find(artifact => artifact.path.startsWith('tools/'))!.content).toContain('not_retained_in_inventory');
  });
  it('preserves retained actual schemas, write classification and precondition references', () => {
    const project = official(), boundary = project.boundaries[0]!, target = project.agents.find(agent => boundary.targetAgentIds.includes(agent.id))!;
    target.toolDefinitions = [{ name: target.tools[0]!, description: 'Recorded actual contract', inputSchema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] },
      writes: true, preconditions: ['Signed-in owner only'], evidenceIds: target.evidenceIds }];
    const tools = JSON.parse(buildFoldingArtifacts(project).find(artifact => artifact.path.startsWith('tools/'))!.content);
    expect(tools.tools[0]).toMatchObject({ name: target.tools[0], inputSchema: target.toolDefinitions[0]!.inputSchema, writes: true, preconditions: ['Signed-in owner only'], schemaStatus: 'retained_contract' });
    expect(tools.tools[0].evidenceIds).toEqual(target.evidenceIds);
  });
  it('exports explicit CLI recipes and required independent structured verification without executing anything', () => {
    const artifacts = buildFoldingArtifacts(official()), recipe = artifacts.find(artifact => artifact.path === 'recipes.md')!.content;
    expect(recipe).toContain('node bin/agent-folding.js PLAN.json'); expect(recipe).toContain('--execute --allow-paid');
    expect(recipe).toContain('ANTHROPIC_API_KEY'); expect(recipe).toContain('do not claim live API verification');
    const schema = JSON.parse(artifacts.find(artifact => artifact.path === 'structured-result.schema.json')!.content);
    expect(schema.required).toEqual(['conclusion', 'evidence', 'actions_taken', 'confidence', 'caveats']);
    expect(schema.$comment).toContain('low-confidence invalid-result');
  });
  it('generates only bounded relative safe artifact paths even for hostile boundary identifiers', () => {
    const project = official(), oldId = project.boundaries[0]!.id, newId = '../../user-agent/.env';
    project.boundaries[0]!.id = newId; project.experiments.forEach(experiment => { if (experiment.boundaryId === oldId) experiment.boundaryId = newId; });
    project.humanDecisions.forEach(decision => { if (decision.boundaryId === oldId) decision.boundaryId = newId; });
    const artifacts = buildFoldingArtifacts(project);
    expect(artifacts.every(artifact => !artifact.path.startsWith('/') && !artifact.path.split('/').includes('..'))).toBe(true);
    expect(new Set(artifacts.map(artifact => artifact.path)).size).toBe(artifacts.length);
  });
  it('rejects stale or forged supplied analysis instead of exporting an adopted winner', () => {
    const project = official(), analysis = analyzeFoldingProject(project);
    analysis.decisions[0]!.status = 'supported';
    expect(() => buildFoldingArtifacts(project, analysis)).toThrow('current project analysis');
    expect(buildFoldingArtifacts(project, analyzeFoldingProject(project)).length).toBeGreaterThan(0);
  });
});
