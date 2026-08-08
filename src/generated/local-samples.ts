// 机器生成，勿手改。生成器：scripts/generate-local-samples.mjs
// 内嵌最小样本（未指定 --claude-source / --opencode-db）
import type { SessionIndexEntry } from '../core/trace-types.js';

export const localSamples: SessionIndexEntry[] = [
  {
    "id": "codex-fallback-1",
    "provider": "codex",
    "sourceAgent": "Codex",
    "title": "fallback sample: fix build",
    "startedAt": "2026-08-01T00:00:00.000Z",
    "updatedAt": "2026-08-01T00:01:00.000Z",
    "status": "success",
    "cwd": null,
    "eventCount": 3,
    "messageCount": 2,
    "tokenTotal": 210,
    "costUsd": 0.01,
    "dataSource": "scan",
    "sourcePath": "fallback://codex-1",
    "detailLoaded": false,
    "mergeGroupId": null,
    "hasSystemPrompt": false,
    "tags": []
  },
  {
    "id": "claude-fallback-1",
    "provider": "claude",
    "sourceAgent": "Claude",
    "title": "fallback sample: explain parser",
    "startedAt": "2026-08-01T00:00:00.000Z",
    "updatedAt": "2026-08-01T00:00:30.000Z",
    "status": "success",
    "cwd": null,
    "eventCount": 2,
    "messageCount": 2,
    "tokenTotal": 120,
    "costUsd": 0.005,
    "dataSource": "scan",
    "sourcePath": "fallback://claude-1",
    "detailLoaded": false,
    "mergeGroupId": null,
    "hasSystemPrompt": false,
    "tags": []
  }
];
