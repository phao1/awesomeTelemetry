import type { TraceEventSlim } from './trace-types.js';

/** Shared reader presentation filter, aligned with TH-004/004a bookkeeping.
 * Only retained metadata is inspected. Never fetch bodies or change health,
 * timing/usage denominators or native records to hide technical rows in the UI. */
export function isSystemRecord(event: Pick<TraceEventSlim, 'kind' | 'title' | 'hasInput' | 'hasOutput'> | null): boolean {
  if (!event) return false;
  if (['system', 'agent', 'subagent_prompt'].includes(event.kind)) return true;
  // Real tool observations must remain visible even if their title is a marker.
  if (['tool', 'bash', 'file_read', 'file_write', 'test'].includes(event.kind)) return false;
  const title = event.title.trim().toLowerCase();
  if (/^(?:system|system prompt|系统提示|app[-_]context|multi_agent_role|environment_context|world_state|turn_context|thread_settings_applied|item_completed|token_count|task_started|task_complete|task_completed)$/.test(title)) return true;
  if (/^<(?:app[-_]context|multi_agent_role|environment_context|world_state|turn_context|thread_settings_applied|system_prompt|system-reminder|developer_instructions|skills|tools)(?:\s|>)/.test(title)) return true;
  return event.kind === 'reasoning' && !event.hasInput && !event.hasOutput && (!title || title === 'reasoning');
}
