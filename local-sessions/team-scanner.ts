import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Database } from 'better-sqlite3';

import { openReadonly } from '../server/storage/db.js';
import { commitScanState, shouldRescan } from '../server/watch/scan-gate.js';
import { readJsonlFrom } from '../server/watch/jsonl-reader.js';
import type { FileFingerprint } from '../src/core/trace-types.js';
import {
  canonicalRunId,
  TEAM_PARSER_VERSION,
  parseCodeArtsTeam,
  redactLocator,
  type CodeArtsCagSessionExtraRow,
  type CodeArtsMessageRow,
  type CodeArtsPartRow,
  type CodeArtsSessionRow,
  type CodeArtsTeamRaw,
  type NormalizedTeamEvidence,
} from '../src/adapters/team-codearts.js';
import { parseCodexTeam, type CodexThreadFile } from '../src/adapters/team-codex.js';
import { deriveSessionKey } from './session-key.js';
import { expandLocalSessionPath } from './config.js';

// ══════════════════════════════════════════════════════════════════════════
// team 源扫描编排（§4.15）。
//
// 与 session scanner 并行的第二条路径：发现 team 源（CodeArts agent-team 目录 +
// opencode.db；Codex sessions 目录），fingerprint/no-change 门禁后解析为
// NormalizedTeamEvidence，交给 storage 层差分摄入（TeamSink），最后合并通知
// affected-run（coalesced，一次调用，不逐 run 发射）。
//
// 硬约束（§4.15）：无 child process（不 spawn）；无大文件同步读（JSONL 走
// readJsonlFrom 流式逐行、opencode.db 走 better-sqlite3 只读查询、目录指纹只
// stat 不读内容）。
// ══════════════════════════════════════════════════════════════════════════

/** storage 层实现的摄入接口（task 3 的 differential upsert）。 */
export interface TeamSink {
  /** 差分摄入一个 run 的完整证据；返回 canonical runId 与新 stamp。 */
  ingestRun(evidence: NormalizedTeamEvidence): { runId: string; stamp: string };
  /** 源消失时删除派生 team 行（仅 team-owned，不碰 session/event）。 */
  deleteRun(runId: string): void;
}

/** team 源注册（scanner 输入）。 */
export interface TeamSourceConfig {
  provider: 'codearts' | 'codex';
  /** 源根目录：CodeArts = agent-team 目录；Codex = sessions 目录。 */
  root: string;
  /** CodeArts 附加源：opencode.db 路径。 */
  auxiliary?: string[];
}

export interface TeamScanContext {
  db: Database;
  force?: boolean;
  sink: TeamSink;
  /** coalesced affected-run 通知（一次调用收集到的全部 runId）。 */
  notify?: (runIds: string[]) => void;
}

export interface TeamScanResult {
  provider: string;
  runs: number;
  skipped: boolean;
  error?: string;
}


/**
 * 目录级指纹（只 stat 不读内容）：总字节 + 最大 mtime + 文件清单合并 hash。
 * 供 scan-gate 复用 no-change 检测（检测新增/删除/大小/mtime 变化）。
 */
function teamDirectoryFingerprint(paths: string[]): FileFingerprint {
  const hasher = createHash('sha256');
  hasher.update(TEAM_PARSER_VERSION);
  let size = 0;
  let mtimeMs = 0;
  const existing = paths.filter((p) => existsSync(p));
  for (const p of existing.sort()) {
    try {
      const st = statSync(p);
      if (st.isFile()) {
        size += st.size;
        mtimeMs = Math.max(mtimeMs, Math.floor(st.mtimeMs));
        hasher.update(`${p}:${st.size}:${st.mtimeMs}`);
      }
    } catch {
      // 文件在枚举与 stat 之间消失：忽略，下轮再测
    }
  }
  return { size, mtimeMs, hash: hasher.digest('hex') };
}

// ── CodeArts 源读取 ──────────────────────────────────────────────────────

function readJsonArray(path: string): unknown[] {
  const text = readFileSync(path, 'utf8');
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function readJsonObject(path: string): Record<string, unknown> {
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * 真实 CodeArts opencode.db（drizzle）的 `data` 列是 JSON 字符串（TEXT），
 * 不是对象。读取后必须逐行 `JSON.parse`，否则 `part.data.type`/`message.data` 全是
 * undefined（对齐 `local-sessions/opencode.ts` 的 `parseJson`）。
 */
function parseDataColumn(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 从 opencode.db 只读提取 team 相关表行（显式列名，无 SELECT *）。 */
function readCodeArtsDb(
  dbPath: string,
): {
  sessions: CodeArtsSessionRow[];
  messages: CodeArtsMessageRow[];
  parts: CodeArtsPartRow[];
  cagSessionExtra: CodeArtsCagSessionExtraRow[];
} {
  const db = openReadonly(dbPath);
  try {
    const sessions = (db
      .prepare(
        `SELECT id, parent_id, type, title, directory, time_created, time_updated FROM session`,
      )
      .all() as Array<Omit<CodeArtsSessionRow, 'data'>>);
    const rawMessages = db
      .prepare(`SELECT id, session_id, time_created, data FROM message`)
      .all() as Array<{ id: string; session_id: string; time_created: number | null; data: unknown }>;
    const rawParts = db
      .prepare(`SELECT id, message_id, session_id, data FROM part`)
      .all() as Array<{ id: string; message_id: string; session_id: string; data: unknown }>;
    const cagSessionExtra = (db
      .prepare(`SELECT session_id, type, extra_info FROM cag_session_extra`)
      .all() as CodeArtsCagSessionExtraRow[]);
    const messages: CodeArtsMessageRow[] = rawMessages.map((m) => ({
      id: m.id,
      session_id: m.session_id,
      time_created: m.time_created,
      data: parseDataColumn(m.data),
    }));
    const parts: CodeArtsPartRow[] = rawParts.map((p) => ({
      id: p.id,
      message_id: p.message_id,
      session_id: p.session_id,
      data: parseDataColumn(p.data),
    }));
    return { sessions, messages, parts, cagSessionExtra };
  } finally {
    db.close();
  }
}

/** 枚举 agent-team 目录下的 session 子目录，返回 (nativeRunId, sourceLocator)。 */
function discoverCodeArtsRuns(agentTeamRoot: string): Array<{ nativeRunId: string; locator: string }> {
  const sessionRoot = join(agentTeamRoot, 'session');
  if (!existsSync(sessionRoot)) {
    return [];
  }
  let entries;
  try {
    entries = readdirSync(sessionRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ nativeRunId: string; locator: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    out.push({
      nativeRunId: entry.name,
      locator: redactLocator(join(sessionRoot, entry.name)),
    });
  }
  return out.sort((a, b) => a.nativeRunId.localeCompare(b.nativeRunId));
}

/** 读取并组装一个 CodeArts run 的 raw（agent-team 目录 + opencode.db）。 */
function readCodeArtsRawForRun(
  agentTeamRoot: string,
  nativeRunId: string,
  locator: string,
  db: ReturnType<typeof readCodeArtsDb> | undefined,
): CodeArtsTeamRaw {
  const sessionDir = join(agentTeamRoot, 'session', nativeRunId);
  const contact = readJsonObject(join(sessionDir, 'contact.json')) as unknown;
  const teamTask = readJsonArray(join(sessionDir, 'team-task.json')) as unknown;
  const contacts = (contact ?? {}) as CodeArtsTeamRaw['contact'];
  const memberIds = new Set([nativeRunId, ...Object.values(contacts).map(member => member.sessionID)]);
  return {
    contact: contacts,
    teamTask: teamTask as CodeArtsTeamRaw['teamTask'],
    sessions: db?.sessions.filter(session => memberIds.has(session.id)),
    messages: db?.messages,
    parts: db?.parts,
    cagSessionExtra: db?.cagSessionExtra.filter(session => memberIds.has(session.session_id)),
    sourceLocator: locator,
  };
}

// ── Codex 源读取 ──────────────────────────────────────────────────────────

/** 读一个 Codex jsonl 文件全部行（流式逐行，见 readJsonlFrom）。 */
async function readCodexThreadFile(sourcePath: string): Promise<CodexThreadFile> {
  const read = await readJsonlFrom(sourcePath, 0);
  return { sourcePath, rows: read.rows };
}

/** 从文件行里提取线程身份（首个 session_meta）。 */
function codexThreadIdOf(rows: unknown[]): string | null {
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      continue;
    }
    const record = row as Record<string, unknown>;
    if (record.type !== 'session_meta') {
      continue;
    }
    const payload = record.payload as Record<string, unknown> | undefined;
    const id = payload?.id;
    if (typeof id === 'string' && id !== '') {
      return id;
    }
  }
  return null;
}

/** 提取 fork 父（forked_from_id / parent_thread_id / thread_spawn.parent_thread_id）。 */
function codexForkParentOf(rows: unknown[]): string | null {
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      continue;
    }
    const record = row as Record<string, unknown>;
    if (record.type !== 'session_meta') {
      continue;
    }
    const payload = record.payload as Record<string, unknown> | undefined;
    if (payload === undefined) {
      continue;
    }
    for (const key of ['forked_from_id', 'parent_thread_id']) {
      if (typeof payload[key] === 'string' && payload[key] !== '') {
        return payload[key] as string;
      }
    }
    const source = payload.source as Record<string, unknown> | undefined;
    const subagent = source?.subagent as Record<string, unknown> | undefined;
    const spawn = subagent?.thread_spawn as Record<string, unknown> | undefined;
    if (typeof spawn?.parent_thread_id === 'string' && spawn.parent_thread_id !== '') {
      return spawn.parent_thread_id as string;
    }
  }
  return null;
}

/** 读 sessions 目录全部 jsonl，按根线程森林分组为 runs。 */
async function discoverCodexRuns(
  sessionsRoot: string,
): Promise<Array<{ nativeRunId: string; locator: string; files: CodexThreadFile[] }>> {
  if (!existsSync(sessionsRoot)) {
    return [];
  }
  let entries;
  try {
    entries = readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: CodexThreadFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const nested = await discoverCodexRuns(join(sessionsRoot, entry.name));
      files.push(...nested.flatMap((r) => r.files));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl') || entry.name.startsWith('.')) {
      continue;
    }
    const sourcePath = join(sessionsRoot, entry.name);
    files.push(await readCodexThreadFile(sourcePath));
  }
  return groupCodexRuns(files, sessionsRoot);
}

/** 把已读的线程文件按 fork 森林分组（root + 其子孙）。 */
function groupCodexRuns(
  files: CodexThreadFile[],
  sessionsRoot: string,
): Array<{ nativeRunId: string; locator: string; files: CodexThreadFile[] }> {
  const byId = new Map<string, CodexThreadFile>();
  const childToParent = new Map<string, string>();
  for (const file of files) {
    const id = codexThreadIdOf(file.rows);
    if (id === null) {
      continue;
    }
    byId.set(id, file);
    const parent = codexForkParentOf(file.rows);
    if (parent !== null && parent !== id) {
      childToParent.set(id, parent);
    }
  }
  const rootIds = [...byId.keys()].filter((id) => !childToParent.has(id));
  const childrenOf = new Map<string, string[]>();
  for (const [child, parent] of childToParent) {
    const list = childrenOf.get(parent) ?? [];
    list.push(child);
    childrenOf.set(parent, list);
  }
  const runs = rootIds.map((rootId) => {
    const memberFiles: CodexThreadFile[] = [];
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const file = byId.get(id);
      if (file !== undefined) {
        memberFiles.push(file);
      }
      for (const child of childrenOf.get(id) ?? []) {
        stack.push(child);
      }
    }
    return {
      nativeRunId: rootId,
      locator: redactLocator(sessionsRoot),
      files: memberFiles,
    };
  });
  // 无 fork 关联的孤立线程（无 session_meta id）各自成 run，避免丢失
  const groupedIds = new Set(runs.flatMap((r) => r.files.map((f) => codexThreadIdOf(f.rows))));
  for (const file of files) {
    const id = codexThreadIdOf(file.rows);
    if (id !== null && !groupedIds.has(id)) {
      runs.push({ nativeRunId: id, locator: redactLocator(sessionsRoot), files: [file] });
      groupedIds.add(id);
    }
  }
  return runs;
}

// ══════════════════════════════════════════════════════════════════════════
// scanTeamSources（编排入口）
// ══════════════════════════════════════════════════════════════════════════

export async function scanTeamSources(
  sources: TeamSourceConfig[],
  ctx: TeamScanContext,
): Promise<TeamScanResult[]> {
  const affected: string[] = [];
  const results: TeamScanResult[] = [];
  for (const source of sources) {
    const result = await scanOneTeamSource(source, ctx, (runId) => affected.push(runId));
    results.push(result);
  }
  if (affected.length > 0) {
    ctx.notify?.(affected);
  }
  return results;
}

async function scanOneTeamSource(
  source: TeamSourceConfig,
  ctx: TeamScanContext,
  collectAffected: (runId: string) => void,
): Promise<TeamScanResult> {
  const root = expandLocalSessionPath(source.root);
  const auxiliary = (source.auxiliary ?? []).map(expandLocalSessionPath);
  try {
    if (source.provider === 'codearts') {
      return await scanCodeArtsSource(root, auxiliary, ctx, collectAffected);
    }
    return await scanCodexSource(root, ctx, collectAffected);
  } catch (err) {
    return {
      provider: source.provider,
      runs: 0,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function scanCodeArtsSource(
  agentTeamRoot: string,
  auxiliary: string[],
  ctx: TeamScanContext,
  collectAffected: (runId: string) => void,
): Promise<TeamScanResult> {
  const paths = [agentTeamRoot, ...auxiliary].filter((p) => existsSync(p));
  const fpFn = (): FileFingerprint => teamDirectoryFingerprint(paths);
  const gate = shouldRescan(ctx.db, agentTeamRoot, fpFn);
  if (!gate.changed && !ctx.force) {
    return { provider: 'codearts', runs: 0, skipped: true };
  }
  const dbPath = auxiliary.find((p) => p.endsWith('.db')) ?? null;
  const resolveEvent = ctx.db.prepare(`SELECT DISTINCT ti.event_id
    FROM trace_identities ti JOIN trace_identity_sources src ON src.id=ti.source_id
    JOIN events e ON e.session_id=src.session_key AND e.id=ti.event_id
    WHERE src.session_key=? AND ti.namespace='agent:codearts' AND ti.kind='tool_call'
      AND ti.scope=? AND ti.value=? AND ti.event_id IS NOT NULL AND src.complete=1`);
  const sessionKeyOf = (nativeId: string): string | null => dbPath === null ? null : deriveSessionKey('codearts', dbPath, nativeId);
  const sourceDb = dbPath !== null && existsSync(dbPath) ? readCodeArtsDb(dbPath) : undefined;
  const runs = discoverCodeArtsRuns(agentTeamRoot);
  let count = 0;
  for (const run of runs) {
    const raw = readCodeArtsRawForRun(agentTeamRoot, run.nativeRunId, run.locator, sourceDb);
    const evidence = parseCodeArtsTeam(raw, { sessionKeyOf, eventIdOf(part) {
      const key = sessionKeyOf(part.session_id);
      const callId = part.data?.callID;
      if (key === null || typeof callId !== 'string' || callId === '') return null;
      const matches = resolveEvent.all(key, part.session_id, callId) as Array<{event_id: string}>;
      return matches.length === 1 ? matches[0]!.event_id : null;
    } });
    fillCodeArtsSessionKeys(evidence, dbPath);
    const { runId } = ctx.sink.ingestRun(evidence);
    collectAffected(runId);
    count += 1;
  }
  commitScanState(ctx.db, {
    sourcePath: agentTeamRoot,
    provider: 'codearts',
    sessionId: null,
    fp: gate.fp,
    byteOffset: gate.fp.size,
    eventCount: count,
  });
  return { provider: 'codearts', runs: count, skipped: false };
}

/** 后处理：给 CodeArts agent 补 session key（design D15 显式关联，不复制/重编号）。 */
function fillCodeArtsSessionKeys(evidence: NormalizedTeamEvidence, dbPath: string | null): void {
  if (dbPath === null) {
    return;
  }
  for (const agent of evidence.agents) {
    agent.sessionKeys = [deriveSessionKey('codearts', dbPath, agent.nativeId)];
  }
}

async function scanCodexSource(
  sessionsRoot: string,
  ctx: TeamScanContext,
  collectAffected: (runId: string) => void,
): Promise<TeamScanResult> {
  const fpFn = (): FileFingerprint => teamDirectoryFingerprint([sessionsRoot]);
  const gate = shouldRescan(ctx.db, sessionsRoot, fpFn);
  if (!gate.changed && !ctx.force) {
    return { provider: 'codex', runs: 0, skipped: true };
  }
  const runs = await discoverCodexRuns(sessionsRoot);
  let count = 0;
  for (const run of runs) {
    const evidence = parseCodexTeam(run.files, run.locator, (nativeId) => {
      const file = run.files.find((f) => codexThreadIdOf(f.rows) === nativeId);
      return file === undefined ? null : deriveSessionKey('codex', file.sourcePath);
    });
    const { runId } = ctx.sink.ingestRun(evidence);
    collectAffected(runId);
    count += 1;
  }
  commitScanState(ctx.db, {
    sourcePath: sessionsRoot,
    provider: 'codex',
    sessionId: null,
    fp: gate.fp,
    byteOffset: gate.fp.size,
    eventCount: count,
  });
  return { provider: 'codex', runs: count, skipped: false };
}

/** 导出 canonicalRunId 供 storage/测试复用（统一 run id 口径）。 */
export { canonicalRunId };
