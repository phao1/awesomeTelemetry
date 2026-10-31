import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../api/client.js';
import type { TaskContext, TaskListQuery, TaskPage, TaskRecordPage, TaskRecordQuery, TaskTimeline } from '../../core/task-types.js';
export function params(values: object): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') q.set(key, String(value));
  return q.toString();
}
export const taskApi = {
  list: async (query: TaskListQuery, signal?: AbortSignal) => { const result = await fetchJson<TaskPage>('/tasks?' + params(query), { signal }); if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.items.some(item => typeof item.id !== 'string' || !['collected', 'imported'].includes(item.origin))) throw new Error('Invalid task list response'); return result; },
  context: async (id: string, signal?: AbortSignal) => { const result = await fetchJson<TaskContext>('/tasks/' + encodeURIComponent(id), { signal }); if (!result?.task || !Array.isArray(result.members) || !Array.isArray(result.warnings)) throw new Error('Invalid task context response'); return result; },
  records: async (id: string, query: TaskRecordQuery, signal?: AbortSignal) => { const result = await fetchJson<TaskRecordPage>('/tasks/' + encodeURIComponent(id) + '/records?' + params(query), { signal }); if (!result || result.context?.task.id !== id || !Array.isArray(result.items) || result.items.length > (query.limit ?? 200) || !Number.isSafeInteger(result.offset) || !Number.isSafeInteger(result.total) || typeof result.window !== 'string') throw new Error('Invalid task record response'); return result; },
  timeline: async (id: string, member: string, window: string, signal?: AbortSignal) => { const result = await fetchJson<TaskTimeline>('/tasks/' + encodeURIComponent(id) + '/timeline?' + params({ member,window }), { signal }); if (!result || result.taskId!==id || result.member!==member || result.window!==window || !Array.isArray(result.lanes) || result.lanes.length>100 || result.bins!==160) throw new Error('Invalid task timeline response'); return result; },
};
/** Scope changes hide old content immediately and retire late requests even if abort is ignored. */
export function useTaskRead<T>(identity: string | null, read: (signal: AbortSignal) => Promise<T>, timeout = 60000) {
  const reader = useRef(read); reader.current = read;
  const [revision, setRevision] = useState(0);
  const key = identity === null ? null : identity + ':' + revision;
  const [state, setState] = useState<{ key: string | null; value: T | null; error: string | null; loading: boolean }>({ key: null, value: null, error: null, loading: false });
  useEffect(() => {
    if (key === null) return;
    let current = true; const controller = new AbortController();
    setState({ key, value: null, error: null, loading: true });
    const timer = setTimeout(() => { current = false; controller.abort(); setState({ key, value: null, error: 'READ_TIMEOUT', loading: false }); }, timeout);
    void reader.current(controller.signal).then(value => { if (current) setState({ key, value, error: null, loading: false }); })
      .catch((error: unknown) => { if (current) setState({ key, value: null, error: error instanceof Error ? error.message : String(error), loading: false }); })
      .finally(() => clearTimeout(timer));
    return () => { current = false; controller.abort(); clearTimeout(timer); };
  }, [key, timeout]);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  return { ...(state.key === key ? state : { value: null, error: null, loading: key !== null }), retry };
}
