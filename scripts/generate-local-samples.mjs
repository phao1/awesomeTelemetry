// REQ-014 / cli-build REQ-007：生成 src/generated/local-samples.ts（机器生成，勿手改）。
// 支持 --claude-source=/path/to.jsonl 与 --opencode-db=/path/to.db（或同名 env）；
// 缺省时写入内嵌最小样本。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'src', 'generated', 'local-samples.ts');

const argv = process.argv.slice(2);
function argValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const claudeSource = argValue('--claude-source') ?? process.env.CLAUDE_SOURCE;
const opencodeDb = argValue('--opencode-db') ?? process.env.OPENCODE_DB;

function sanitizePath(rawPath) {
  return String(rawPath).replace(homedir(), '~');
}

function extractIso(time) {
  if (typeof time === 'string') {
    try {
      const parsed = JSON.parse(time);
      if (typeof parsed.created === 'number') {
        return new Date(parsed.created).toISOString();
      }
    } catch {
      // 非 JSON，原样返回
    }
    return time;
  }
  if (time !== null && time !== undefined && typeof time.created === 'number') {
    return new Date(time.created).toISOString();
  }
  return new Date(0).toISOString();
}

// 缺省内嵌最小样本（2 条会话索引，API 不可用时的 fallback）。
const fallbackSessions = [
  {
    id: 'codex-fallback-1',
    provider: 'codex',
    sourceAgent: 'Codex',
    title: 'fallback sample: fix build',
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: null,
    eventCount: 3,
    messageCount: 2,
    tokenTotal: 210,
    costUsd: 0.01,
    dataSource: 'scan',
    sourcePath: 'fallback://codex-1',
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  },
  {
    id: 'claude-fallback-1',
    provider: 'claude',
    sourceAgent: 'Claude',
    title: 'fallback sample: explain parser',
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:30.000Z',
    status: 'success',
    cwd: null,
    eventCount: 2,
    messageCount: 2,
    tokenTotal: 120,
    costUsd: 0.005,
    dataSource: 'scan',
    sourcePath: 'fallback://claude-1',
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  },
];

let sourceNote = '内嵌最小样本（未指定 --claude-source / --opencode-db）';
let samples = fallbackSessions;

if (claudeSource !== undefined || opencodeDb !== undefined) {
  sourceNote = `来自 ${claudeSource ?? '-'} / ${opencodeDb ?? '-'}`;
  samples = [];
  if (claudeSource !== undefined && existsSync(claudeSource)) {
    // REQ-007：读 Claude JSONL，取 sessionId 与首条文本做标题（sanitize 路径）
    const lines = readFileSync(claudeSource, 'utf8').split('\n');
    const seen = new Set();
    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }
      try {
        const row = JSON.parse(line);
        const id = row.sessionId ?? row.session_id ?? row.uuid;
        if (typeof id !== 'string' || seen.has(id)) {
          continue;
        }
        seen.add(id);
        const text = Array.isArray(row.message?.content)
          ? (row.message.content.find((p) => p.type === 'text')?.text ?? '')
          : '';
        samples.push({
          id: `claude-${id.slice(0, 14)}`,
          provider: 'claude',
          sourceAgent: 'Claude',
          title: String(text || id).slice(0, 200),
          startedAt: row.timestamp ?? new Date(0).toISOString(),
          updatedAt: row.timestamp ?? new Date(0).toISOString(),
          status: 'unknown',
          cwd: null,
          eventCount: 0,
          messageCount: 0,
          tokenTotal: 0,
          costUsd: 0,
          dataSource: 'scan',
          sourcePath: sanitizePath(claudeSource),
          detailLoaded: false,
          mergeGroupId: null,
          hasSystemPrompt: false,
        });
      } catch {
        // 跳过坏行
      }
    }
  }
  if (opencodeDb !== undefined && existsSync(opencodeDb)) {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(opencodeDb, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare('SELECT id, title, time, directory FROM session ORDER BY rowid LIMIT 50')
        .all();
      for (const row of rows) {
        samples.push({
          id: `opencode-${String(row.id).slice(0, 14)}`,
          provider: 'opencode',
          sourceAgent: 'OpenCode',
          title: String(row.title ?? row.id).slice(0, 200),
          startedAt: extractIso(row.time),
          updatedAt: new Date(0).toISOString(),
          status: 'unknown',
          cwd: row.directory ?? null,
          eventCount: 0,
          messageCount: 0,
          tokenTotal: 0,
          costUsd: 0,
          dataSource: 'scan',
          sourcePath: sanitizePath(opencodeDb),
          detailLoaded: false,
          mergeGroupId: null,
          hasSystemPrompt: false,
        });
      }
    } finally {
      db.close();
    }
  }
}

const content = `// 机器生成，勿手改。生成器：scripts/generate-local-samples.mjs
// ${sourceNote}
import type { SessionIndexEntry } from '../core/trace-types.js';

export const localSamples: SessionIndexEntry[] = ${JSON.stringify(samples, null, 2)};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, content, 'utf8');
console.log(`generated ${outPath}（${samples.length} 条样本）`);
