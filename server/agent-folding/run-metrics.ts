import { FoldingSourceError, FOLDING_SOURCE_BYTE_LIMIT, openSourceStream, sourceBudget, relevantSourceLine, sourceFingerprint, unavailableSource } from './source.js';
import type { SourceBudget } from './source.js';
import { createInterface } from 'node:readline';
import type { Database } from 'better-sqlite3';
import type { BenchmarkSpan, BenchmarkUsage } from '../../src/core/benchmark-types.js';
import { EMPTY_USAGE } from '../../src/core/benchmark-types.js';
import { correctedUsage } from '../../src/core/benchmark-analysis.js';
import type { FoldingMetricRun } from '../../src/core/agent-folding-metrics.js';
import { EMPTY_FOLDING_LABELS } from '../../src/core/agent-folding-metrics.js';
import type { FoldingProject } from '../../src/core/agent-folding-types.js';
import { getTask } from '../storage/task-workbench.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { getLinkedExecution } from '../storage/linked-execution.js';
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const sum = (a: Array<number | null>) => a.length && a.every(v => v !== null) ? a.reduce<number>((s, v) => s + v!, 0) : null;
interface SourceCall { id: string; eventIds: string[]; at: string | null; model: string | null; usage: BenchmarkUsage }
interface SourceTool { eventId?: string; id: string; at: string | null }
async function sourceMetrics(path: string, provider: string, budget: SourceBudget, signal?: AbortSignal) {
  const calls = new Map<string, SourceCall>(), tools = new Map<string, SourceTool>();
  let cumulative: BenchmarkUsage | null = null;
  const stream = await openSourceStream(path, budget, signal);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const usage = (u: Record<string, unknown>): BenchmarkUsage => ({
    input: number(u.input_tokens), output: number(u.output_tokens),
    reasoning: provider === 'claude' ? number(object(u.output_tokens_details).thinking_tokens) : number(u.reasoning_output_tokens),
    cacheRead: number(provider === 'claude' ? u.cache_read_input_tokens : u.cached_input_tokens),
    cacheWrite: number(provider === 'claude' ? u.cache_creation_input_tokens : u.cache_write_input_tokens),
    inputIncludesCache: provider === 'codex', outputIncludesReasoning: true,
    cacheWriteReported: (provider === 'claude' ? 'cache_creation_input_tokens' : 'cache_write_input_tokens') in u ? true : provider === 'codex' ? false : null,
  });
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      if (!relevantSourceLine(line, provider === 'claude' ? ['assistant'] : ['token_count', 'function_call'])) continue;
      let row: Record<string, unknown>; try { row = object(JSON.parse(line)); } catch { throw new FoldingSourceError('INVALID_SOURCE', 'Invalid native metric JSONL'); }
      const msg = object(row.message), payload = object(row.payload), at = typeof row.timestamp === 'string' ? row.timestamp : null;
      if (provider === 'claude' && row.type === 'assistant' && typeof msg.id === 'string') {
        const parts = Array.isArray(msg.content) ? msg.content.map(object) : [];
        const eventIds = parts.map((part, i) => typeof part.id === 'string' ? part.id : `${msg.id}-${i + 1}`);
        calls.set(msg.id, { id: msg.id, eventIds, at, model: typeof msg.model === 'string' ? msg.model : null, usage: usage(object(msg.usage)) });
        for (const part of parts) if (part.type === 'tool_use' && typeof part.id === 'string') tools.set(part.id, { id: part.id, at });
      }
      if (provider === 'codex') {
        if (payload.type === 'token_count' && object(payload.info).total_token_usage != null) cumulative = usage(object(object(payload.info).total_token_usage));
        if (row.type === 'response_item' && payload.type === 'function_call' && typeof payload.call_id === 'string') tools.set(payload.call_id, { id: payload.call_id, at });
      }
    }
  } finally { lines.close(); stream.destroy(); }
  const values = [...calls.values()].map(c => c.usage);
  const total: BenchmarkUsage = provider === 'codex' ? cumulative ?? { ...EMPTY_USAGE, cacheWriteReported: null } : {
    input: sum(values.map(u => u.input)), output: sum(values.map(u => u.output)), reasoning: sum(values.map(u => u.reasoning)),
    cacheRead: sum(values.map(u => u.cacheRead)), cacheWrite: sum(values.map(u => u.cacheWrite)),
    inputIncludesCache: false, outputIncludesReasoning: true, cacheWriteReported: values.length && values.every(u => u.cacheWriteReported === true) ? true : null,
  };
  return { calls: [...calls.values()], tools: [...tools.values()], total };
}
/** No scan/capture/evaluation execution. Source prose is discarded while streaming. */
export async function collectFoldingMetricRun(db: Database, taskId: string, project: FoldingProject, signal?: AbortSignal, options: { byteLimit?: number } = {}): Promise<FoldingMetricRun> {
  const context = getTask(db, taskId), keys = context.members.flatMap(m => m.sessionKey ? [m.sessionKey] : []);
  if (context.task.origin !== 'collected' || context.task.id !== taskId || !keys.length) throw new FoldingSourceError('NO_MATCH', 'Native metrics require a collected root task');
  const rows = cachedStmt(db, 'SELECT id,provider,source_path,started_at,updated_at,detail_loaded,primary_model,token_input,token_output,token_reasoning,token_cache_read,token_cache_write FROM sessions WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(keys)) as Array<{ id: string; provider: string; source_path: string; started_at: string; updated_at: string; detail_loaded: number; primary_model: string | null; token_input: number; token_output: number; token_reasoning: number; token_cache_read: number; token_cache_write: number }>;
  if (rows.some(r => !['claude', 'codex'].includes(r.provider) || r.provider !== context.task.provider)) throw new FoldingSourceError('NO_MATCH', 'Provider accounting has not been verified');
  const fingerprint = async () => JSON.stringify(await Promise.all(rows.map(async r => { return [r.id, await sourceFingerprint(r.source_path)]; })));
  const revision = () => String(db.pragma('data_version', { simple: true })) + ':' + String((cachedStmt(db, 'SELECT total_changes() AS n').get() as { n: number }).n);
  const beforeRevision = revision(), beforeFiles = await fingerprint();
  const start = Math.min(...rows.map(r => Date.parse(r.started_at))), end = Math.max(...rows.map(r => Date.parse(r.updated_at)));
  const spans: BenchmarkSpan[] = [], usages: BenchmarkUsage[] = [], subUsage: Array<number | null> = [], budget = sourceBudget(signal, options.byteLimit ?? FOLDING_SOURCE_BYTE_LIMIT), models = new Set<string>();
  const limitations = [...context.warnings, '原生日志时长不是逐次实测；缺少验收结果时保持未知'];
  const capturesUsed = new Set<number>(); let callsKnown = true, toolCount = 0, modelCount = 0, missingCount = 0;
  for (const row of rows) {
    signal?.throwIfAborted();
    let source: Awaited<ReturnType<typeof sourceMetrics>>, indexed = false;
    try { source = await sourceMetrics(row.source_path, row.provider, budget, signal); }
    catch (error) {
      if (!unavailableSource(error)) throw error;
      missingCount++; callsKnown = false; indexed = true;
      const indexedTools = cachedStmt(db, `WITH call_ids AS (
        SELECT i.event_id,CASE WHEN COUNT(DISTINCT i.value)=1 THEN MIN(i.value) ELSE NULL END AS native_id
        FROM trace_identity_sources s JOIN trace_identities i ON i.source_id=s.id
        WHERE s.session_key=? AND i.kind='tool_call' GROUP BY i.event_id
      ) SELECT e.id,e.started_at AS at,c.native_id FROM events e LEFT JOIN call_ids c ON c.event_id=e.id
        WHERE e.session_id=? AND e.kind='tool' ORDER BY e.sequence`).all(row.id, row.id) as Array<SourceTool & { native_id: string | null }>;
      const toolsById = new Map<string, SourceTool>();
      for (const tool of indexedTools) {
        const id = tool.native_id ?? tool.id;
        if (!toolsById.has(id)) toolsById.set(id, { id, eventId: tool.id, at: tool.at });
      }
      const tools = [...toolsById.values()];
      // Legacy counters default absent fields to zero. Only positive indexed fields establish reported usage.
      const known = (v: number) => v > 0 ? v : null;
      source = { calls: [], tools, total: { input: known(row.token_input), output: known(row.token_output), reasoning: row.provider === 'codex' ? known(row.token_reasoning) : null,
        cacheRead: known(row.token_cache_read), cacheWrite: known(row.token_cache_write), inputIncludesCache: false, outputIncludesReasoning: true, cacheWriteReported: row.token_cache_write > 0 ? true : row.provider === 'codex' ? false : null } };
    }
    modelCount += source.calls.length;
    usages.push(source.total); if (row.id !== context.task.rootSessionKey) subUsage.push(correctedUsage(source.total).total);
    if (row.primary_model) models.add(row.primary_model);
    if (row.provider === 'codex') { callsKnown = false; limitations.push('Codex 累计 Token 可用；模型调用次数未由原生唯一请求记录确认'); }
    const localSpans: Array<{ span: BenchmarkSpan; eventIds: string[] }> = [];
    for (const call of source.calls) {
      if (call.model) models.add(call.model);
      localSpans.push({ eventIds: call.eventIds, span: { id: `${row.id}:model:${call.id}`, kind: 'model', name: 'Native model call',
        startMs: call.at && Number.isFinite(Date.parse(call.at)) ? Math.max(0, Date.parse(call.at) - start) : 0,
        durationMs: null, timing: 'observed', status: 'unknown', firstTokenMs: null, outputTokens: call.usage.output, sessionKey: row.id, eventId: call.eventIds[0] ?? null } });
    }
    toolCount += source.tools.length;
    for (const tool of source.tools) spans.push({ id: `${row.id}:tool:${tool.id}`, kind: 'tool', name: indexed ? 'Indexed tool event' : 'Native tool call', startMs: tool.at && Number.isFinite(Date.parse(tool.at)) ? Math.max(0, Date.parse(tool.at) - start) : 0,
      durationMs: null, timing: 'observed', status: 'unknown', firstTokenMs: null, outputTokens: null, sessionKey: row.id, eventId: tool.eventId ?? tool.id });
    // A session link alone is insufficient. Only exact retained request/response/message identities may supply timing.
    const hasCapture = cachedStmt(db, "SELECT 1 FROM trace_associations WHERE session_key=? AND state IN ('direct','confirmed') LIMIT 1").get(row.id);
    const total = (cachedStmt(db, 'SELECT event_count FROM sessions WHERE id=?').get(row.id) as { event_count: number }).event_count;
    if (hasCapture && total > 20000) limitations.push(`抓包时序匹配已跳过：${total} 个事件超过 20000 上限，保留 observed 时序。`);
    let offset = 0;
    let remainingEvents: boolean;
    if (hasCapture && total <= 20000) do {
      signal?.throwIfAborted();
      let cursor: number | undefined;
      do {
        const page = getLinkedExecution(db, row.id, { eventOffset: offset, eventLimit: 200, captureLimit: 50, captureCursor: cursor });
        for (const attempt of page.attempts) {
          const timing = attempt.transport?.timing;
          if (capturesUsed.has(attempt.request.id) || !timing || timing.contentTimingStatus !== 'observed' || timing.firstContentBasis !== 'sse_event_dispatch'
            || timing.firstContentMs === null || timing.completedMs === null || timing.firstContentMs > timing.completedMs) continue;
          const ids = attempt.matches.filter(m => ['request', 'response', 'message'].includes(m.kind)).map(m => m.eventId);
          const matches = localSpans.filter(s => s.eventIds.some(id => ids.includes(id)));
          if (matches.length !== 1 || matches[0]!.span.timing === 'measured') continue;
          const span = matches[0]!.span; span.durationMs = timing.completedMs; span.firstTokenMs = timing.firstContentMs; span.timing = 'measured'; span.outputTokens = attempt.request.outputTokens;
          capturesUsed.add(attempt.request.id);
        }
        cursor = page.nextCaptureCursor ?? undefined;
        if (!page.capturesHasMore) break;
      } while (cursor !== undefined);
      offset += 200;
      remainingEvents = offset < total;
    } while (remainingEvents);
    for (const local of localSpans) spans.push(local.span);
  }
  const inputConventions = new Set(usages.map(u => u.inputIncludesCache));
  if (inputConventions.size > 1) {
    for (const usage of usages) {
      if (usage.inputIncludesCache !== false) {
        // Included input covers both cache reads and reported cache writes.
        const write = usage.cacheWriteReported === false ? 0 : usage.cacheWrite;
        const input = usage.input !== null && usage.cacheRead !== null && write !== null && usage.inputIncludesCache === true
          ? usage.input - usage.cacheRead - write : null;
        usage.input = input !== null && input >= 0 ? input : null;
      }
      usage.inputIncludesCache = false;
    }
    limitations.push('成员输入 Token 口径混合，已统一为不含缓存的输入；缓存读写未知时该成员输入保持未知。');
  }
  const consistent = <K extends 'inputIncludesCache' | 'outputIncludesReasoning' | 'cacheWriteReported'>(key: K) => usages.length && usages.every(u => u[key] === usages[0]![key]) ? usages[0]![key] ?? null : null;
  const usage: BenchmarkUsage = { input: sum(usages.map(u => u.input)), output: sum(usages.map(u => u.output)), reasoning: sum(usages.map(u => u.reasoning)), cacheRead: sum(usages.map(u => u.cacheRead)), cacheWrite: sum(usages.map(u => u.cacheWrite)), inputIncludesCache: consistent('inputIncludesCache'), outputIncludesReasoning: consistent('outputIncludesReasoning'), cacheWriteReported: consistent('cacheWriteReported') };
  const traffic = project.traffic.filter(t => t.traceId === context.task.id), refs = new Map(project.evidence.map(e => [e.id, e]));
  const actualModel = models.size === 1 ? [...models][0]! : null;
  if (rows.some(r => r.detail_loaded !== 1)) limitations.push('明细不完整时仍显示原生用量；事件索引、委派定位与模型/工具计数可能不完整，不能据此确认时延或任务质量。');
  if (missingCount) limitations.push(`${missingCount} 个成员的原始日志已不在本机或不可读；用量与工具数来自数据库索引 (indexed)，缺失字段与零值口径未知，模型调用与时延不完整。`);
  const spansOmitted = spans.length > 2000;
  if (spansOmitted) { limitations.push(`${spans.length} 个 span 超过 2000 条明细上限；保留完整用量与调用计数，省略全部 span，逐调用时延指标未知。`); spans.length = 0; }
  const indexedComplete = rows.length === keys.length && rows.every(r => r.detail_loaded === 1);
  const complete = indexedComplete && missingCount === 0 && !spansOmitted;
  if (beforeFiles !== await fingerprint() || beforeRevision !== revision()) throw new FoldingSourceError('SOURCE_CHANGED', 'Task changed while reading metrics; refresh');
  return { id: context.task.id, taskId: context.task.id, expectedTests: null,
    labels: { ...EMPTY_FOLDING_LABELS, productMode: context.task.provider, model: actualModel, ttftSource: capturesUsed.size ? 'proxy' : 'unknown' },
    run: { id: context.task.id, variantId: context.task.provider, repetition: 1, startedAt: new Date(start).toISOString(), status: 'completed', host: 'unknown', e2eMs: Number.isFinite(end - start) ? Math.max(0, end - start) : null,
      telemetry: { actualModel, sessionKey: context.task.rootSessionKey, complete, usage, spans }, verdict: null, phases: [], error: null },
    recorded: { ...(!complete ? { input: usage.input, output: usage.output, reasoning: usage.reasoning } : {}), modelCalls: indexedComplete && callsKnown ? modelCount : null, toolCalls: indexedComplete ? toolCount : null },
    architecture: { subAgents: context.members.length - 1, delegations: traffic.length, linkedDelegations: traffic.filter(t => refs.get(t.evidenceId)?.complete).length, subagentTokens: subUsage.length ? sum(subUsage) : 0, mainWaitMs: null },
    limitations: [...new Set(limitations)] };
}
