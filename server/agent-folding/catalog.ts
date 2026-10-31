import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { FoldingProject, FoldingRunPlan } from '../../src/core/agent-folding-types.js';
import { validateFoldingProject } from '../../src/core/agent-folding-validation.js';
import type { SupportDeskFixture } from './fixture.js';

const directory = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../../data/agent-folding/' : '../data/agent-folding/', import.meta.url));
export const SINGLE_LOOP_KIT_REVISION = 'c43796287b83bec847db923f07131d1cc8de750d';
async function loadChecked(name: string, key: 'projectSha256' | 'fixtureSha256'): Promise<unknown> {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  if (manifest.revision !== SINGLE_LOOP_KIT_REVISION) throw new Error('Pinned reference revision changed.');
  const path = join(directory, name), metadata = await stat(path);
  if (metadata.size > 8 * 1024 * 1024) throw new Error('Reference catalog exceeds the bounded load.');
  const bytes = await readFile(path);
  if (bytes.length !== metadata.size || createHash('sha256').update(bytes).digest('hex') !== manifest[key]) throw new Error('Reference catalog integrity check failed.');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
/** Explicit catalog load only; the recordings are historical evidence, not fresh model execution. */
export async function loadFoldingExample(): Promise<FoldingProject> {
  return validateFoldingProject(await loadChecked('support-desk-project.json', 'projectSha256'));
}
export async function loadSupportDeskFixture(): Promise<SupportDeskFixture> {
  return await loadChecked('support-desk/fixture.json', 'fixtureSha256') as SupportDeskFixture;
}
export const DEFAULT_FOLDING_PLAN: Readonly<FoldingRunPlan> = Object.freeze({
  version: 1, kind: 'agent-folding-plan', title: 'Support desk · fold one returns boundary',
  adapter: 'support-desk', provider: 'fixture', model: null,
  boundaryId: 'returns', operation: 'fold', targetAgentIds: ['returns'],
  caseIds: Array.from({ length: 19 }, (_, i) => 't' + String(i + 1).padStart(2, '0')),
  repetitions: 2, schedule: 'sequential',
  budgets: { maxCallsPerCase: 64, maxOutputTokens: 4096, maxInputChars: 250000, maxTotalTokensPerCase: 300000, timeoutMs: 120000, maxToolBatch: 16 },
  external: null,
  skillAblation: true,
});
export function toFoldingPlanDefault(): FoldingRunPlan { return structuredClone(DEFAULT_FOLDING_PLAN); }
