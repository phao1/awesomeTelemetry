// REQ-014 / cli-build REQ-007：生成 src/generated/local-samples.ts（机器生成，勿手改）。
// 支持 --claude-source=/path/to.jsonl 与 --opencode-db=/path/to.db；缺省时写入内嵌最小样本。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'src', 'generated', 'local-samples.ts');

const argv = process.argv.slice(2);
function argValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const claudeSource = argValue('--claude-source');
const opencodeDb = argValue('--opencode-db');

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
if (claudeSource !== undefined || opencodeDb !== undefined) {
  sourceNote = `来自 ${claudeSource ?? '-'} / ${opencodeDb ?? '-'}（M12 接线完整解析）`;
}

const content = `// 机器生成，勿手改。生成器：scripts/generate-local-samples.mjs
// ${sourceNote}
import type { SessionIndexEntry } from '../core/trace-types.js';

export const localSamples: SessionIndexEntry[] = ${JSON.stringify(fallbackSessions, null, 2)};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, content, 'utf8');
console.log(`generated ${outPath}`);
