import type { CodeArtsPartRow, CodeArtsTeamRaw, NormalizedTeamEvidence } from './team-codearts.js';
import { canonicalEntityId, normalizeMs } from './team-codearts.js';
import type { TeamActivityKind, TeamActivitySlim, TeamAssignment, TeamTask } from '../core/trace-types.js';

const CONTROL_TOOLS = new Set(['publish-task', 'background-task', 'get-my-task', 'claim-task', 'update-team-task', 'finish-task', 'background-output', 'send-message']);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const bodyText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 32768 ? `${text.slice(0, 32768)}\n[Evidence truncated: original ${text.length} characters]` : text;
};

/** Pure source mapping. Tool control evidence is not a delivered inter-agent message. */
export function addCodeArtsReplayEvidence(input: {
  raw: CodeArtsTeamRaw; activities: TeamActivitySlim[]; tasks: TeamTask[]; assignments: TeamAssignment[];
  agentByNative: ReadonlyMap<string, string>; taskByNative: ReadonlyMap<number, string>;
  runId: string; nativeRunId: string;
  ref: (nativeId: string | null, sequence: number | null, confidence: 'native') => string;
  links?: { sessionKeyOf: (id: string) => string | null; eventIdOf: (part: CodeArtsPartRow) => string | null };
}): NonNullable<NormalizedTeamEvidence['activityBodies']> {
  const { raw, activities, taskByNative, runId, nativeRunId } = input;
  const bodies: NonNullable<NormalizedTeamEvidence['activityBodies']> = [];
  const baseByNative = new Map(activities.map(activity => [activity.id, activity]));
  const publishedTaskIds = new Set<number>();
  const times = new Map(raw.messages?.map(message => [message.id, message.time_created]));
  for (const part of raw.parts ?? []) {
    const data = part.data ?? {};
    const tool = typeof data.tool === 'string' ? data.tool : '';
    if (data.type !== 'tool' || !CONTROL_TOOLS.has(tool)) { continue; }
    const state = object(data.state);
    const args = object(state?.input);
    const original = baseByNative.get(canonicalEntityId('codearts', nativeRunId, 'act', part.id));
    if (!original) { continue; }
    const ids: number[] = [];
    const push = (value: unknown): void => { const id = integer(value); if (id !== null && taskByNative.has(id) && !ids.includes(id)) ids.push(id); };
    let kind: TeamActivityKind = 'tool_call';
    if (tool === 'publish-task') {
      kind = 'task_created';
      for (const task of Array.isArray(args?.todos) ? args.todos : []) push(object(task)?.id);
    } else if (tool === 'background-task') {
      kind = 'task_assignment';
      for (const id of Array.isArray(args?.assign_task_id) ? args.assign_task_id : []) push(id);
    } else if (tool === 'claim-task') {
      // A read/idempotent confirmation is not a new assignment transition.
      kind = 'tool_result';
      push(args?.id);
    } else if (tool === 'finish-task' || tool === 'update-team-task') {
      kind = tool === 'update-team-task' && args?.status === undefined ? 'task_assignment' : 'task_status';
      push(args?.id);
    } else if (tool === 'get-my-task') {
      kind = 'tool_result';
    } else if (tool === 'background-output') {
      kind = 'tool_result';
    } else if (tool === 'send-message') {
      // Keep the real attempt; no recipient entity or delivered-message count is invented.
      kind = 'unknown';
    }
    const report = {
      tool, operation: kind,
      taskStatus: tool === 'finish-task' && typeof state?.output === 'string' && state.output.startsWith('You have finished task(id=') ? 'completed_reported' : typeof args?.status === 'string' ? args.status : null,
      targetSession: typeof args?.session_id === 'string' && !args.session_id.includes('undefined') ? args.session_id : null,
      delivery: tool === 'send-message' ? 'unconfirmed' : null,
      verification: 'unavailable',
      sourcePartId: part.id, sourceMessageId: part.message_id,
    };
    // One activity per explicit task reference. Ordinary work keeps taskId=null.
    const taskIds: Array<number | null> = ids.length > 0 ? ids : [null];
    const evidenceId = original.evidenceIds[0]!;
    for (const nativeTaskId of taskIds) {
      const eventKind = tool === 'publish-task' && nativeTaskId !== null && publishedTaskIds.has(nativeTaskId) ? 'tool_result' : kind;
      if (tool === 'publish-task' && nativeTaskId !== null) publishedTaskIds.add(nativeTaskId);
      const activity: TeamActivitySlim = {
        ...original,
        id: canonicalEntityId('codearts', nativeRunId, 'act', `${part.id}:control:${nativeTaskId ?? 'unknown'}`),
        runId, taskId: nativeTaskId === null ? null : taskByNative.get(nativeTaskId)!,
        kind: eventKind, startedAt: normalizeMs(times.get(part.message_id)),
        evidenceIds: [evidenceId], orderConfidence: 'ambiguous', hasInput: args !== null,
        hasOutput: state?.output !== null && state?.output !== undefined,
        hasRaw: false,
      };
      activities.push(activity);
      bodies.push({ activity_id: activity.id, input_body: bodyText(args), output_body: bodyText(state?.output),
        message_body: null, result_body: bodyText(report), raw_body: null });
    }
  }
  return bodies;
}
