/** Canonical additive DTOs: openspec/contracts/team-experiment.md. */
import type { BenchmarkManifest, BenchmarkRun, BenchmarkVariant } from './benchmark-types.js';

export type TeamExperimentMode = 'single_loop' | 'subagents' | 'agent_team';
export interface TeamExperimentVariant extends BenchmarkVariant {
  mode: TeamExperimentMode;
  prompt: string;
}
export interface TeamExperimentPlan {
  version: 1;
  kind: 'team-experiment';
  name: string;
  repetitions: number;
  schedule: 'parallel' | 'sequential';
  task: BenchmarkManifest['task'] & { caseIds: string[] };
  variants: TeamExperimentVariant[];
}
export interface TeamExperimentAgent {
  id: string; name: string; parentId: string | null; sessionKey: string | null;
}
export type TeamExperimentEventKind = 'model' | 'tool' | 'task' | 'message' | 'wait' | 'handoff' | 'verification' | 'artifact' | 'rework' | 'context';
export interface TeamExperimentEvent {
  id: string; agentId: string; targetAgentId: string | null;
  kind: TeamExperimentEventKind; name: string; detail: string | null;
  startMs: number; durationMs: number | null;
  timing: 'measured' | 'observed' | 'derived';
  status: 'ok' | 'error' | 'unknown';
  dependsOn: string[]; tokens: number | null;
  sessionKey: string | null; eventId: string | null;
}
export interface TeamExperimentEvidence {
  coverage: { roster: boolean; activities: boolean; communication: boolean };
  agents: TeamExperimentAgent[];
  events: TeamExperimentEvent[];
}
export interface TeamExperimentCase {
  id: string; status: 'passed' | 'failed' | 'unknown'; detail: string | null;
}
export interface TeamExperimentTrial {
  id: string; variantId: string; repetition: number; promptSha256: string;
  run: BenchmarkRun;
  cases: TeamExperimentCase[] | null;
  evidence: TeamExperimentEvidence | null;
  evidenceError: string | null;
}
export interface TeamExperimentReport {
  version: 1; kind: 'team-experiment-report'; synthetic: boolean;
  plan: TeamExperimentPlan; commit: string; createdAt: string;
  trials: TeamExperimentTrial[];
}
export type TeamExperimentScenario = 'single_wins' | 'subagents_win' | 'team_quality' | 'incomplete';
export interface TeamExperimentDemoInput {
  name: string; repetitions: number; schedule: 'parallel' | 'sequential';
  variants: Array<{ mode: TeamExperimentMode; prompt: string }>;
}
