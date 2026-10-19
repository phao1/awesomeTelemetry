import type { TeamActivityKind, TeamActivitySlim } from '../../core/trace-types.js';

export type ReplayPhase = 'setup' | 'assignment' | 'execution' | 'coordination' | 'report' | 'output' | 'verification' | 'unknown';
export interface ReplayStage {
  id: string; phase: ReplayPhase; time: string | null; ambiguous: boolean;
  agentId: string | null; taskId: string | null; activities: TeamActivitySlim[];
}
const phaseOf = (kind: TeamActivityKind): ReplayPhase => {
  if (kind === 'task_created' || kind === 'task_dependency' || kind === 'agent_lifecycle') return 'setup';
  if (kind === 'task_assignment') return 'assignment';
  if (kind === 'message_sent' || kind === 'message_received' || kind === 'handoff') return 'coordination';
  if (kind === 'task_status') return 'report';
  if (kind === 'artifact' || kind === 'integration' || kind === 'tool_result') return 'output';
  if (kind === 'verification') return 'verification';
  if (kind === 'unknown') return 'unknown';
  return 'execution';
};
const timeOf = (time: string | null): string | null => time !== null && Number.isFinite(Date.parse(time)) ? time : null;

/** No time-window matching. Only the same explicit native turn can group work. */
export function buildReplayStages(runId: string, activities: readonly TeamActivitySlim[]): { timed: ReplayStage[]; undated: ReplayStage[] } {
  const unique = [...new Map(activities.filter(activity => activity.runId === runId).map(activity => [activity.id, activity])).values()];
  const controls = new Set(unique.filter(activity => activity.kind !== 'tool_call' && activity.kind !== 'round').flatMap(activity => activity.evidenceIds));
  const groups = new Map<string, ReplayStage>();
  for (const activity of unique) {
    if (activity.kind === 'tool_call' && activity.evidenceIds.some(id => controls.has(id))) continue;
    const phase = phaseOf(activity.kind);
    const time = timeOf(activity.startedAt);
    const key = phase === 'execution' && activity.turnKey !== null && activity.agentId !== null
      ? JSON.stringify([activity.sessionKey, activity.agentId, activity.taskId, activity.turnKey, time === null])
      : activity.id;
    const previous = groups.get(key);
    if (previous) {
      previous.activities.push(activity);
      if (time !== null && (previous.time === null || time < previous.time)) previous.time = time;
      previous.ambiguous ||= activity.orderConfidence === 'ambiguous';
    } else groups.set(key, { id: activity.id, phase, time, ambiguous: activity.orderConfidence === 'ambiguous',
      agentId: activity.agentId, taskId: activity.taskId, activities: [activity] });
  }
  const stages = [...groups.values()];
  const compare = (a: ReplayStage, b: ReplayStage): number => (a.time ?? '').localeCompare(b.time ?? '')
    || (a.activities[0]!.nativeSequence ?? Number.MAX_SAFE_INTEGER) - (b.activities[0]!.nativeSequence ?? Number.MAX_SAFE_INTEGER)
    || a.id.localeCompare(b.id);
  const timed = stages.filter(stage => stage.time !== null).sort(compare);
  const times = new Map<string, number>();
  for (const stage of timed) times.set(stage.time!, (times.get(stage.time!) ?? 0) + 1);
  for (const stage of timed) stage.ambiguous ||= times.get(stage.time!)! > 1;
  return { timed, undated: stages.filter(stage => stage.time === null).sort(compare) };
}
