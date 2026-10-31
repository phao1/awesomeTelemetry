import { FoldingSourceError, FOLDING_SOURCE_BYTE_LIMIT, openSourceStream, sourceBudget, relevantSourceLine, sourceFingerprint, unavailableSource } from './source.js';
import type { SourceBudget } from './source.js';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Database } from 'better-sqlite3';
import type { FoldingAgent, FoldingNativeScope, FoldingProject } from '../../src/core/agent-folding-types.js';
import { decideFoldingInventory } from '../../src/core/agent-folding-rules.js';
import { validateFoldingProject } from '../../src/core/agent-folding-validation.js';
import { getTask, listTasks } from '../storage/task-workbench.js';
import { cachedStmt } from '../storage/stmt-cache.js';

const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const string = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v : null;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);
const json = (v: unknown): Record<string, unknown> | null => {
  if (typeof v !== 'string') return object(v);
  try { return object(JSON.parse(v)); } catch { return null; }
};
interface Session { id: string; source_path: string; cwd: string | null; provider: string }
interface Call { eventId?: string; indexedIdentity?: boolean; id: string; definition: string | null; timestamp: string | null }
interface Source { nativeId: string | null; role: string | null; calls: Map<string, Call>; results: Map<string, string> }

/** Explicit reads only; raw conversation content is never retained in the result. */
async function readSource(path: string, budget: SourceBudget, signal?: AbortSignal): Promise<Source> {
  const result: Source = { nativeId: null, role: null, calls: new Map(), results: new Map() };
  const stream = await openSourceStream(path, budget, signal);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      if (!relevantSourceLine(line, ['session_meta', 'isSidechain', 'sessionId', 'tool_use', 'tool_result', 'function_call'])) continue;
      const row = json(line); if (!row) continue;
      const payload = object(row.payload), message = object(row.message);
      if (row.type === 'session_meta' && payload) {
        result.nativeId = string(payload.id);
        const spawn = object(object(object(payload.source)?.subagent)?.thread_spawn);
        result.role = string(payload.agent_role) ?? string(spawn?.agent_role);
      }
      if (row.isSidechain === true) result.nativeId = string(row.agentId) ?? result.nativeId;
      else if (!result.nativeId) result.nativeId = string(row.sessionId);
      const content = message?.content;
      if (Array.isArray(content)) for (const value of content) {
        const block = object(value); if (!block) continue;
        const id = string(block.id);
        if (block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task') && id) {
          result.calls.set(id, { id, definition: string(object(block.input)?.subagent_type), timestamp: string(row.timestamp) });
        }
        const toolId = string(block.tool_use_id), agentId = string(object(row.toolUseResult)?.agentId);
        if (block.type === 'tool_result' && toolId && agentId) result.results.set(toolId, agentId);
      }
      const callId = string(payload?.call_id);
      if (row.type === 'response_item' && payload && callId) {
        if (payload.type === 'function_call' && payload.name === 'spawn_agent') {
          result.calls.set(callId, { id: callId, definition: null, timestamp: string(row.timestamp) });
        }
        if (payload.type === 'function_call_output') {
          const target = string(json(payload.output)?.agent_id);
          if (target) result.results.set(callId, target);
        }
      }
    }
  } finally { lines.close(); stream.destroy(); }
  return result;
}

export function validateFoldingNativeScope(scope: FoldingNativeScope): FoldingNativeScope {
  if (Object.keys(scope).some(k => !['provider', 'cwd', 'from', 'to', 'taskIds'].includes(k))) throw new FoldingSourceError('NO_MATCH', 'Unknown scope field.');
  if (scope.provider !== undefined && !['claude', 'codex'].includes(scope.provider)) throw new FoldingSourceError('NO_MATCH', 'Unsupported provider.');
  for (const v of [scope.from, scope.to]) if (v !== undefined && (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(v) || !Number.isFinite(Date.parse(v)))) throw new FoldingSourceError('NO_MATCH', 'Scope dates must be ISO UTC.');
  if (scope.from && scope.to && Date.parse(scope.from) > Date.parse(scope.to)) throw new FoldingSourceError('NO_MATCH', 'Invalid time range.');
  if (scope.cwd !== undefined && (typeof scope.cwd !== 'string' || !scope.cwd || scope.cwd.length > 4096)) throw new FoldingSourceError('NO_MATCH', 'Invalid project directory.');
  if (scope.taskIds !== undefined && (!Array.isArray(scope.taskIds) || !scope.taskIds.length || scope.taskIds.length > 40 || new Set(scope.taskIds).size !== scope.taskIds.length || scope.taskIds.some(id => typeof id !== 'string' || !id.startsWith('collected:') || id.length > 1024))) throw new FoldingSourceError('NO_MATCH', 'Invalid root tasks.');
  return { provider: scope.provider, cwd: scope.cwd, from: scope.from, to: scope.to, ...(scope.taskIds ? { taskIds: [...scope.taskIds].sort() } : {}) };
}

export function createNativeScopeCollector(db: Database, options: { byteLimit?: number; ensureDetail?: (sessionKey: string, signal?: AbortSignal) => Promise<unknown> } = {}) {
  const cache = new Map<string, { revision: string; project: FoldingProject }>();
  const revision = () => String(db.pragma('data_version', { simple: true })) + ':' + (cachedStmt(db, 'SELECT total_changes() AS n').get() as { n: number }).n;
  let closed = false;
  return {
    close() { closed = true; cache.clear(); },
    async collect(selection: FoldingNativeScope, signal?: AbortSignal): Promise<FoldingProject> {
      if (closed) throw new FoldingSourceError('NO_MATCH', 'Collector closed.');
      signal?.throwIfAborted();
      const scope = validateFoldingNativeScope(selection);
      const ids = scope.taskIds ?? (() => {
        const all: string[] = [];
        let offset = 0;
        for (;;) {
          const page = listTasks(db, { origin: 'collected', ...(scope.provider ? { provider: scope.provider } : {}), offset, limit: 100 });
          all.push(...page.items.map(t => t.id));
          if (!page.hasMore) return all;
          offset += 100;
          if (offset > 10000) throw new FoldingSourceError('TOO_LARGE', 'Task selection too broad.', { tasks: offset, limit: 40 });
        }
      })();
      const loadContexts = () => ids.map(id => {
        const context = getTask(db, id);
        if (scope.taskIds && id !== context.task.id) throw new FoldingSourceError('NO_MATCH', 'Select root tasks.');
        return context;
      }).filter(context => {
        const task = context.task;
        if (scope.taskIds && task.id !== 'collected:' + task.rootSessionKey) throw new FoldingSourceError('NO_MATCH', 'Select root tasks.');
        if (!['claude', 'codex'].includes(task.provider) || scope.provider && task.provider !== scope.provider) return false;
        if (scope.from && (!task.startedAt || Date.parse(task.startedAt) < Date.parse(scope.from))) return false;
        if (scope.to && (!task.startedAt || Date.parse(task.startedAt) > Date.parse(scope.to))) return false;
        const root = cachedStmt(db, 'SELECT cwd FROM sessions WHERE id = ?').get(task.rootSessionKey) as { cwd: string | null } | undefined;
        return !scope.cwd || root?.cwd === scope.cwd;
      });
      let contexts = loadContexts();
      if (!contexts.length) throw new FoldingSourceError('NO_MATCH', 'No tasks match the native scope.');
      if (new Set(contexts.map(c => c.task.provider)).size > 1) throw new FoldingSourceError('NO_MATCH', 'Select one provider for an architecture audit.');
      if (contexts.length > 40) throw new FoldingSourceError('TOO_LARGE', 'Native scope exceeds 40 tasks.', { tasks: contexts.length, limit: 40 });
      let detailLoadFailures = 0;
      if (options.ensureDetail) {
        const attempted = new Set<string>();
        for (;;) {
          const memberKeys = [...new Set(contexts.flatMap(c => c.members.flatMap(m => m.sessionKey ? [m.sessionKey] : [])))];
          const pending = (cachedStmt(db, 'SELECT id,source_path FROM sessions WHERE detail_loaded=0 AND id IN (SELECT value FROM json_each(?)) ORDER BY id').all(JSON.stringify(memberKeys)) as { id: string; source_path: string }[]).filter(row => !attempted.has(row.id));
          if (!pending.length) break;
          for (const row of pending) {
            attempted.add(row.id);
            signal?.throwIfAborted();
            let abort = () => {};
            try {
              if (await sourceFingerprint(row.source_path) === 'missing') continue;
              signal?.throwIfAborted();
              // Retire an uncooperative dependency at the owned job's deadline too.
              const aborted = signal ? new Promise<never>((_resolve, reject) => {
                abort = () => reject(signal.reason);
                signal.addEventListener('abort', abort, { once: true });
              }) : null;
              const loading = options.ensureDetail(row.id, signal);
              await (aborted ? Promise.race([loading, aborted]) : loading);
            } catch {
              signal?.throwIfAborted();
              detailLoadFailures++;
            } finally { signal?.removeEventListener('abort', abort); }
            signal?.throwIfAborted();
          }
          // Loading can establish new membership, identities and completeness.
          contexts = loadContexts();
        }
      }
      // All intentional lazy-index writes precede the read consistency snapshot.
      const stamp = revision();
      const keys = [...new Set(contexts.flatMap(c => c.members.flatMap(m => m.sessionKey ? [m.sessionKey] : [])))];
      const sessions = cachedStmt(db, 'SELECT id,source_path,cwd,provider FROM sessions WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').all(JSON.stringify(keys)) as Session[];
      const fingerprints = async () => Promise.all(sessions.map(async s => { return [s.id, await sourceFingerprint(s.source_path)]; }));
      const before = JSON.stringify(await fingerprints()), key = JSON.stringify(scope), fullRevision = stamp + before;
      const hit = cache.get(key);
      if (signal?.aborted) throw new FoldingSourceError('NO_MATCH', 'Cancelled');
      if (revision() !== stamp) throw new FoldingSourceError('SOURCE_CHANGED', 'Source changed; refresh audit');
      if (hit?.revision === fullRevision) return structuredClone(hit.project);
      const project: FoldingProject = { version: 1, kind: 'agent-folding-project', id: 'scope-' + hash(scope), title: 'Native architecture scope', createdAt: new Date().toISOString(),
        sources: [{ id: 'native', kind: 'native_telemetry', title: 'Retained native records', url: null, revision: hash(fullRevision), observedAt: null, model: null, limitations: [] }],
        agents: [], boundaries: [], cases: [], traffic: [], experiments: [], trials: [], evidence: [], humanDecisions: [], limitations: ['No evaluation outcomes inferred. Unknown duration and input counts remain unavailable.'] };
      if (detailLoadFailures) project.limitations.push(`${detailLoadFailures} 个成员的详情加载失败；保留可读原文与现有索引，打开任务执行轨迹加载详情后重试可补全。`);
      const records = new Map<string, Source>(), budget = sourceBudget(signal, options.byteLimit ?? FOLDING_SOURCE_BYTE_LIMIT);
      const missing = new Set<string>();
      for (const session of sessions) {
        try { records.set(session.id, await readSource(session.source_path, budget, signal)); }
        catch (error) {
          if (!unavailableSource(error)) throw error;
          missing.add(session.id);
          const identities = cachedStmt(db, `SELECT DISTINCT i.value FROM trace_identity_sources s JOIN trace_identities i ON i.source_id=s.id WHERE s.session_key=? AND i.kind='session' AND i.scope IS NULL`).all(session.id) as { value: string }[];
          const calls = cachedStmt(db, `WITH call_ids AS (
            SELECT i.event_id,CASE WHEN COUNT(DISTINCT i.value)=1 THEN MIN(i.value) ELSE NULL END AS call_id
            FROM trace_identity_sources s JOIN trace_identities i ON i.source_id=s.id
            WHERE s.session_key=? AND i.kind='tool_call' GROUP BY i.event_id
          ) SELECT e.id AS eventId,e.started_at AS timestamp,c.call_id FROM events e
            LEFT JOIN call_ids c ON c.event_id=e.id
            WHERE e.session_id=? AND e.kind='tool' AND e.tool IN ('spawn_agent','Agent','Task') ORDER BY e.sequence`).all(session.id, session.id) as { eventId: string; call_id: string | null; timestamp: string }[];
          records.set(session.id, { nativeId: identities.length === 1 ? identities[0]!.value : null, role: null, calls: new Map(calls.map(c => [c.call_id ?? c.eventId, { id: c.call_id ?? c.eventId, eventId: c.eventId, indexedIdentity: c.call_id !== null, timestamp: c.timestamp, definition: null }])), results: new Map() });
        }
      }
      if (missing.size) project.limitations.push(`${missing.size} 个成员的原始日志已不在本机或不可读，委派关系与角色来自索引，可能不完整 (indexed source fallback).`);
      const resolveChild = (members: typeof contexts[number]['members'], parentId: string, source: Source, callId: string, indexed: boolean) => {
        const target = source.results.get(callId);
        const children = members.filter(m => m.parentId === parentId && m.sessionKey);
        const matches = target !== undefined ? children.filter(m => records.get(m.sessionKey!)?.nativeId === target) : indexed && source.calls.get(callId)?.indexedIdentity && source.calls.size === 1 ? children : [];
        return matches.length === 1 ? matches[0] : undefined;
      };
      const agent = (provider: string, name: string, isMain: boolean, unknownKey?: string): FoldingAgent => {
        const id = 'agent-' + hash([provider, name, isMain, unknownKey ?? null]);
        let found = project.agents.find(a => a.id === id);
        if (!found) { found = { id, name, owner: null, isMain, prompt: null, tools: [], invokedBy: [], returns: null, talksToUser: null, externalOwner: null, contextNeed: 'unknown', proposed: isMain ? 'main' : 'insufficient', rationale: { zh: '待核实独立上下文理由。', en: 'Independent context reasons require verification.' }, evidenceIds: [] }; project.agents.push(found); }
        return found;
      };
      let unresolved = 0, unindexed = 0;
      for (const context of contexts) {
        project.limitations.push(...context.warnings);
        if (context.members.some(m => !m.detailLoaded)) project.limitations.push('Scope includes unindexed members; membership may be incomplete.');
        const provider = context.task.provider, main = agent(provider, 'main', true);
        const memberAgents = new Map<string, FoldingAgent>();
        if (context.task.rootSessionKey) memberAgents.set(context.task.rootSessionKey, main);
        // Resolve definition assignments before traversal; task members are sorted by
        // storage key, not parent-before-child order.
        for (const parent of context.members) {
          const source = parent.sessionKey ? records.get(parent.sessionKey) : undefined;
          if (!source) continue;
          for (const call of source.calls.values()) {
            const child = resolveChild(context.members, parent.id, source, call.id, missing.has(parent.sessionKey!));
            if (!child?.sessionKey) continue;
            const name = call.definition ?? records.get(child.sessionKey)?.role;
            memberAgents.set(child.sessionKey, agent(provider, name ?? 'unknown', false, name ? undefined : context.task.id + ':' + call.id));
          }
        }
        for (const member of context.members) {
          if (!member.sessionKey) continue;
          const source = records.get(member.sessionKey); if (!source) continue;
          // An unresolved target already has a per-call unknown definition. Do not
          // invent another definition for an unassigned leaf in a degraded scope.
          if (missing.size && !source.calls.size && !memberAgents.has(member.sessionKey)) continue;
          const caller = memberAgents.get(member.sessionKey) ?? agent(provider, source.role ?? 'unknown', false, source.role ? undefined : member.sessionKey);
          for (const call of source.calls.values()) {
            const child = resolveChild(context.members, member.id, source, call.id, missing.has(member.sessionKey));
            const name = call.definition ?? (child?.sessionKey ? records.get(child.sessionKey)?.role : null) ?? null;
            const callee = agent(provider, name ?? 'unknown', false, name ? undefined : context.task.id + ':' + call.id);
            if (child?.sessionKey) memberAgents.set(child.sessionKey, callee);
            const evidenceId = 'e-' + hash([context.task.id, member.sessionKey, call.id]);
            const refs = cachedStmt(db, `SELECT DISTINCT i.event_id FROM trace_identity_sources s JOIN trace_identities i ON i.source_id=s.id JOIN events e ON e.session_id=s.session_key AND e.id=i.event_id WHERE s.session_key=? AND i.kind='tool_call' AND i.value=? AND e.kind='tool' ORDER BY e.sequence`).all(member.sessionKey, call.id) as { event_id: string }[];
            const eventId = refs[0]?.event_id ?? call.eventId ?? null;
            if (!eventId) unindexed++;
            if (!child || !eventId) unresolved++;
            project.evidence.push({ id: evidenceId, sourceId: 'native', path: 'tool_call', pointer: null, sha256: null, kind: 'trace', excerpt: null, text: null, complete: Boolean(child && eventId), native: { taskId: context.task.id, sessionKey: member.sessionKey, eventId, captureId: null, callSequence: null } });
            callee.evidenceIds.push(evidenceId);
            if (!eventId || missing.has(member.sessionKey) && !child) {
              project.traffic.push({ traceId: context.task.id, sequence: project.traffic.length, agentId: callee.id, callerId: caller.id, timestamp: call.timestamp, durationMs: null, inputTokens: null, evidenceId });
              continue;
            }
            const boundaryId = 'boundary-' + hash([caller.id, callee.id]);
            let boundary = project.boundaries.find(b => b.id === boundaryId);
            if (!boundary) {
              boundary = { id: boundaryId, fromAgentId: caller.id, targetAgentIds: [callee.id], proposed: 'insufficient', title: { zh: callee.name, en: callee.name }, rationale: callee.rationale, requirements: ['Verify independent context reasons and baseline coverage.'], evidenceIds: [] };
              project.boundaries.push(boundary);
            }
            boundary.evidenceIds.push(evidenceId);
            if (!callee.invokedBy.includes(caller.id)) callee.invokedBy.push(caller.id);
            project.traffic.push({ traceId: context.task.id, sequence: project.traffic.length, agentId: callee.id, callerId: caller.id, timestamp: call.timestamp, durationMs: null, inputTokens: null, evidenceId });
          }
        }
      }
      project.traffic.sort((a, b) => a.traceId.localeCompare(b.traceId) || (a.timestamp && b.timestamp ? Date.parse(a.timestamp) - Date.parse(b.timestamp) : 0) || a.sequence - b.sequence);
      project.traffic.forEach((call, i) => { call.sequence = i; });
      if (unindexed) project.limitations.push(`${unindexed} 次委派尚未建立索引，无法定位到事件；打开该任务的执行轨迹加载详情后重试可补全。`);
      if (unresolved) project.limitations.push(`Unresolved delegation: ${unresolved}; targets are unknown and require verification.`);
      project.limitations = [...new Set(project.limitations)];
      if (revision() !== stamp || JSON.stringify(await fingerprints()) !== before) throw new FoldingSourceError('SOURCE_CHANGED', 'Native sources changed during collection.');
      signal?.throwIfAborted();
      const decisions = decideFoldingInventory(project);
      for (const agent of project.agents) agent.proposed = decisions.find(d => d.agentId === agent.id)!.action;
      for (const boundary of project.boundaries) {
        const decision = decisions.find(d => d.agentId === boundary.targetAgentIds[0])!;
        boundary.proposed = decision.action === 'main' ? 'insufficient' : decision.action;
        if (decision.action === 'merge' && decision.mergeWith && !boundary.targetAgentIds.includes(decision.mergeWith)) boundary.targetAgentIds.push(decision.mergeWith);
      }
      for (const [field, limit] of [['agents', 32], ['boundaries', 64], ['evidence', 2000], ['traffic', 10000]] as const) {
        if (project[field].length > limit) throw new FoldingSourceError('TOO_LARGE', 'Architecture projection exceeds its limit.', { [field]: project[field].length, limit });
      }
      const valid = validateFoldingProject(project);
      if (cache.size >= 8) cache.delete(cache.keys().next().value!);
      cache.set(key, { revision: fullRevision, project: structuredClone(valid) });
      return valid;
    },
  };
}
