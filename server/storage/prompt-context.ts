import type { Database } from 'better-sqlite3';

import type { ProviderKey, SessionPromptContext } from '../../src/core/trace-types.js';
import { cachedStmt } from './stmt-cache.js';

const UPSERT_PROMPT_CONTEXT_SQL =
  `INSERT INTO session_prompt_context (` +
  `session_id, provider, source, completeness, captured_at, sections_json, ` +
  `model_config_json, analysis_json, full_system_prompt) ` +
  `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
  `ON CONFLICT(session_id) DO UPDATE SET ` +
  `provider = excluded.provider, source = excluded.source, ` +
  `completeness = excluded.completeness, captured_at = excluded.captured_at, ` +
  `sections_json = excluded.sections_json, model_config_json = excluded.model_config_json, ` +
  `analysis_json = excluded.analysis_json, full_system_prompt = excluded.full_system_prompt`;

const SELECT_PROMPT_CONTEXT_SQL =
  `SELECT session_id, provider, source, completeness, captured_at, sections_json, ` +
  `model_config_json, analysis_json, full_system_prompt ` +
  `FROM session_prompt_context WHERE session_id = ?`;
const DELETE_PROMPT_CONTEXT_SQL = 'DELETE FROM session_prompt_context WHERE session_id = ?';

export function upsertPromptContext(db: Database, context: SessionPromptContext): void {
  cachedStmt(db, UPSERT_PROMPT_CONTEXT_SQL).run(
    context.sessionId,
    context.provider,
    context.source,
    context.completeness,
    context.capturedAt,
    JSON.stringify(context.dynamicSections),
    JSON.stringify(context.modelConfig),
    JSON.stringify(context.analysis),
    context.fullSystemPrompt ?? null,
  );
}

export function getPromptContext(db: Database, sessionId: string): SessionPromptContext | null {
  const row = cachedStmt(db, SELECT_PROMPT_CONTEXT_SQL).get(sessionId) as
    | {
        session_id: string;
        provider: ProviderKey;
        source: SessionPromptContext['source'];
        completeness: SessionPromptContext['completeness'];
        captured_at: string;
        sections_json: string;
        model_config_json: string;
        analysis_json: string;
        full_system_prompt: string | null;
      }
    | undefined;
  if (row === undefined) {
    return null;
  }
  return {
    sessionId: row.session_id,
    provider: row.provider,
    source: row.source,
    completeness: row.completeness,
    capturedAt: row.captured_at,
    dynamicSections: JSON.parse(row.sections_json) as SessionPromptContext['dynamicSections'],
    modelConfig: JSON.parse(row.model_config_json) as SessionPromptContext['modelConfig'],
    analysis: JSON.parse(row.analysis_json) as SessionPromptContext['analysis'],
    fullSystemPrompt: row.full_system_prompt,
  };
}

export function deletePromptContext(db: Database, sessionId: string): void {
  cachedStmt(db, DELETE_PROMPT_CONTEXT_SQL).run(sessionId);
}
