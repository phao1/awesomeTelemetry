import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { SessionPromptContext } from '../../src/core/trace-types.js';
import { initSchema } from './schema.js';
import { getPromptContext, upsertPromptContext } from './prompt-context.js';
import { deleteSession, upsertSessionFromTrace } from './writers.js';

function seedSession(db: InstanceType<typeof Database>): void {
  upsertSessionFromTrace(db, {
    id: 'trae-s1', provider: 'trae', sourceAgent: 'Trae', title: 't',
    startedAt: '2026-08-06T00:00:00.000Z', updatedAt: '2026-08-06T00:01:00.000Z',
    status: 'success', cwd: null, messageCount: 1, eventCount: 1,
    tokenUsage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 1, total: 2 },
    costUsd: 0, systemPrompt: null, dataSource: 'scan', sourcePath: '/tmp/trae.db',
    totalDurationMs: 1, isSubagent: false,
  });
}

function context(capturedAt = '2026-08-06T00:00:00.000Z'): SessionPromptContext {
  return {
    sessionId: 'trae-s1', provider: 'trae', source: 'trae_db', completeness: 'dynamic_only',
    capturedAt,
    dynamicSections: [{ id: 'reminder-1', category: 'language', title: 'Language', content: '中文', chars: 2, estimatedTokens: 1, duplicateOf: null }],
    modelConfig: { modelName: 'glm', configName: 'glm', promptMaxTokens: 100000, maxOutputTokens: 16000, maxTurns: 70, isPreset: true, locale: 'zh', agentType: 'builder', agentName: 'Builder', enabledFeatures: [] },
    analysis: { totalChars: 2, estimatedTokens: 1, sectionCount: 1, uniqueSectionCount: 1, duplicateSectionCount: 0, duplicateChars: 0, contextWindowPercent: 0.001 },
    fullSystemPrompt: null,
  };
}

describe('Prompt Context storage', () => {
  it('幂等 upsert 并显式列读取', () => {
    const db = new Database(':memory:');
    initSchema(db);
    seedSession(db);
    upsertPromptContext(db, context());
    upsertPromptContext(db, context('2026-08-06T00:02:00.000Z'));
    expect(getPromptContext(db, 'trae-s1')).toEqual(context('2026-08-06T00:02:00.000Z'));
    const count = db.prepare('SELECT COUNT(*) AS c FROM session_prompt_context').get() as { c: number };
    expect(count.c).toBe(1);
    db.close();
  });

  it('删除 session 同步删除 Prompt Context', () => {
    const db = new Database(':memory:');
    initSchema(db);
    seedSession(db);
    upsertPromptContext(db, context());
    deleteSession(db, 'trae-s1');
    expect(getPromptContext(db, 'trae-s1')).toBeNull();
    db.close();
  });
});
