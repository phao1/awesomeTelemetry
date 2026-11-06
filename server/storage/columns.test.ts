import { describe, expect, it } from 'vitest';
import { PROXY_CAPTURE_ANALYSIS_COLS } from './columns.js';

describe('metadata-only capture reparse columns', () => {
  it('adopts the exact schema18 explicit column contract without source content', () => {
    expect(PROXY_CAPTURE_ANALYSIS_COLS).toBe('proxy_id, parser_version, metric_version, source_fingerprint, parsed_at, request_format, state, usage_json, completeness_json');
    expect(PROXY_CAPTURE_ANALYSIS_COLS).not.toMatch(/body|raw|summary|headers|system_prompt|snapshots|\*/);
  });
});

import Database from 'better-sqlite3';
import { RSI_SCHEMA_SQL } from './schema.js';
import {
  RSI_TASK_COLS, RSI_ITERATION_COLS, RSI_EVALUATION_COLS, RSI_RUN_COLS,
  RSI_FINDING_COLS, RSI_DECISION_COLS, RSI_INSTRUCTION_COLS, RSI_QUEUE_COLS, RSI_HEAD_COLS,
} from './columns.js';

const rsiColumns = [
  ['rsi_tasks', RSI_TASK_COLS, 'id, state, updated_at, entity_json'],
  ['rsi_iterations', RSI_ITERATION_COLS, 'task_id, id, seq, parent_id, commit_sha, state, created_at, entity_json'],
  ['rsi_evaluations', RSI_EVALUATION_COLS, 'task_id, id, iteration_id, commit_sha, phase, state, created_at, ledger_seq, entity_json'],
  ['rsi_runs', RSI_RUN_COLS, 'task_id, id, evaluation_id, question_id, repetition, attempt, outcome, entity_json'],
  ['rsi_findings', RSI_FINDING_COLS, 'task_id, id, iteration_id, level, category, entity_json'],
  ['rsi_decisions', RSI_DECISION_COLS, 'task_id, id, iteration_id, verdict, at, entity_json'],
  ['rsi_instructions', RSI_INSTRUCTION_COLS, 'task_id, id, effective_from_seq, entity_json'],
  ['rsi_queue', RSI_QUEUE_COLS, 'task_id, id, kind, state, iteration_id, evaluation_id, created_at, entity_json'],
  ['rsi_heads', RSI_HEAD_COLS, 'task_id, seq, hash'],
] as const;

describe('RSI-008.2 exact explicit cache columns', () => {
  it.each(rsiColumns)('%s agrees with the authority and actual schema25 column order', (table, actual, expected) => {
    const db = new Database(':memory:');
    try {
      db.exec(RSI_SCHEMA_SQL);
      expect(actual).toBe(expected);
      expect(actual).not.toContain('*');
      const columns = db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(table) as Array<{ name: string }>;
      expect(actual.split(', ')).toEqual(columns.map(column => column.name));
    } finally { db.close(); }
  });
});
