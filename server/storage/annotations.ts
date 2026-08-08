import type { Database } from 'better-sqlite3';

import type {
  SessionAnnotations,
  SessionAnnotationsUpdate,
} from '../../src/core/trace-types.js';
import { SESSION_ANNOTATION_COLS } from './columns.js';
import { cachedStmt } from './stmt-cache.js';

/**
 * Session annotations 读写（add-trajectory-inspector D13，
 * contracts/data-model.md §3.2 / contracts/database.md §3.10）。
 *
 * - 标签规范化恰为 D13：trim → lowercase → 去重 → 升序；以 JSON 数组存储。
 * - 四个边界（ANNOTATION_MAX_TAGS / ANNOTATION_TAG_MAX_CHARS /
 *   ANNOTATION_TAG_PATTERN / ANNOTATION_NOTE_MAX_CHARS）任一被违反 →
 *   抛 `AnnotationBoundError`（HTTP 层映射为 400），**绝不静默截断**，
 *   且任何内容都不落库。
 * - 部分更新：缺省键不动；`tags: []` 清空标签；`note: null` 清空备注。
 * - 未注解会话的读返回 空数组 / null / null，且**不创建行**。
 * - 全部语句为模块级缓存 prepared statement；显式列清单，禁止 SELECT *。
 */

export const ANNOTATION_MAX_TAGS = 32;
export const ANNOTATION_TAG_MAX_CHARS = 64;
export const ANNOTATION_TAG_PATTERN = /^[\p{L}\p{N}_-]{1,64}$/u;
export const ANNOTATION_NOTE_MAX_CHARS = 8192;

/** 边界违反（HTTP 层映射 400 BAD_REQUEST）。typed error，绝不静默截断。 */
export class AnnotationBoundError extends Error {
  readonly kind = 'annotation_bound' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AnnotationBoundError';
  }
}

/** 会话不存在（HTTP 层映射 404 SESSION_NOT_FOUND）。 */
export class AnnotationSessionNotFoundError extends Error {
  readonly kind = 'annotation_session_not_found' as const;

  constructor(key: string) {
    super(`No session with key ${key}`);
    this.name = 'AnnotationSessionNotFoundError';
  }
}

const READ_ANNOTATIONS_SQL =
  `SELECT ${SESSION_ANNOTATION_COLS} FROM session_annotations WHERE session_id = ?`;
const SESSION_EXISTS_SQL = 'SELECT 1 AS present FROM sessions WHERE id = ?';
const UPSERT_ANNOTATIONS_SQL =
  `INSERT INTO session_annotations (session_id, tags_json, note, updated_at) ` +
  'VALUES (?, ?, ?, ?) ' +
  'ON CONFLICT(session_id) DO UPDATE SET ' +
  'tags_json = excluded.tags_json, note = excluded.note, updated_at = excluded.updated_at';
const TAG_VOCABULARY_SQL =
  'SELECT je.value AS tag, COUNT(*) AS count ' +
  'FROM session_annotations sa, json_each(sa.tags_json) AS je ' +
  'GROUP BY je.value ORDER BY count DESC, tag ASC';

/**
 * D13 规范化：trim → lowercase → 去重 → 升序。输入必须是已通过逐条边界校验
 * 的原始标签数组（规范化前的数量上限也已在调用方校验）。
 */
export function normaliseTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag !== '' && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

/** 逐条校验单个标签；违反任一规则抛 `AnnotationBoundError`。 */
export function assertValidTag(tag: string, index: number): void {
  const trimmed = tag.trim();
  if (trimmed === '') {
    throw new AnnotationBoundError(
      `Tag at index ${index} is empty after trimming; a tag must match ` +
        `${ANNOTATION_TAG_PATTERN.source}`,
    );
  }
  if (trimmed.length > ANNOTATION_TAG_MAX_CHARS) {
    throw new AnnotationBoundError(
      `Tag at index ${index} has ${trimmed.length} chars; ` +
        `the maximum is ${ANNOTATION_TAG_MAX_CHARS}`,
    );
  }
  if (!ANNOTATION_TAG_PATTERN.test(trimmed)) {
    throw new AnnotationBoundError(
      `Tag at index ${index} ("${trimmed}") contains characters outside ` +
        `${ANNOTATION_TAG_PATTERN.source}`,
    );
  }
}

/** 校验整组标签：数量上限 + 逐条规则。任何违反抛 `AnnotationBoundError`。 */
export function assertValidTags(tags: string[]): void {
  if (tags.length > ANNOTATION_MAX_TAGS) {
    throw new AnnotationBoundError(
      `Submitted ${tags.length} tags; the maximum is ${ANNOTATION_MAX_TAGS}`,
    );
  }
  for (let i = 0; i < tags.length; i += 1) {
    const tag = tags[i];
    if (tag === undefined) {
      continue;
    }
    assertValidTag(tag, i);
  }
}

/** 校验备注；违反抛 `AnnotationBoundError`。 */
export function assertValidNote(note: string): void {
  if (note.length > ANNOTATION_NOTE_MAX_CHARS) {
    throw new AnnotationBoundError(
      `Note has ${note.length} chars; the maximum is ${ANNOTATION_NOTE_MAX_CHARS}`,
    );
  }
}

/** 未注解会话的读结果：空标签 / null 备注 / null 时间戳，不创建行。 */
function emptyAnnotations(sessionKey: string): SessionAnnotations {
  return { sessionKey, tags: [], note: null, updatedAt: null };
}

function parseTagsJson(tagsJson: unknown): string[] {
  if (typeof tagsJson !== 'string' || tagsJson === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function mapRow(
  sessionKey: string,
  row: { session_id: string; tags_json: string; note: string | null; updated_at: string },
): SessionAnnotations {
  return {
    sessionKey,
    tags: parseTagsJson(row.tags_json),
    note: row.note,
    updatedAt: row.updated_at,
  };
}

/**
 * 读取一个会话的注解。无行时返回 { tags: [], note: null, updatedAt: null }
 * 且**不创建行**（api.md §1.7 行为 1）。主键查找。
 */
export function readAnnotations(db: Database, sessionKey: string): SessionAnnotations {
  const row = cachedStmt(db, READ_ANNOTATIONS_SQL).get(sessionKey) as
    | { session_id: string; tags_json: string; note: string | null; updated_at: string }
    | undefined;
  return row === undefined ? emptyAnnotations(sessionKey) : mapRow(sessionKey, row);
}

/**
 * 写入注解。D13 部分更新语义：缺省键不动；`tags: []` 清空标签；
 * `note: null` 清空备注。每次成功写都刷新 updated_at（ISO 8601 UTC）。
 * 未知会话抛 `AnnotationSessionNotFoundError`；边界违反抛
 * `AnnotationBoundError` 且**什么也不持久化**。
 */
export function writeAnnotations(
  db: Database,
  sessionKey: string,
  update: SessionAnnotationsUpdate,
): SessionAnnotations {
  if (cachedStmt(db, SESSION_EXISTS_SQL).get(sessionKey) === undefined) {
    throw new AnnotationSessionNotFoundError(sessionKey);
  }

  const current = readAnnotations(db, sessionKey);

  // 先校验再合并：任何违反 → 抛错，什么也不持久化。
  if (update.tags !== undefined) {
    assertValidTags(update.tags);
  }
  if (update.note !== undefined && update.note !== null) {
    assertValidNote(update.note);
  }

  const tags = update.tags !== undefined ? normaliseTags(update.tags) : current.tags;
  const note = update.note !== undefined ? update.note : current.note;
  const updatedAt = new Date().toISOString();

  // 写入前把 undefined 转 null（data-model.md §0 约定；tags 恒为 JSON 字符串）。
  cachedStmt(db, UPSERT_ANNOTATIONS_SQL).run(
    sessionKey,
    JSON.stringify(tags),
    note ?? null,
    updatedAt,
  );
  return { sessionKey, tags, note, updatedAt };
}

/**
 * 标签词表：每个去重标签 + 携带它的会话数，count 降序、标签升序。
 * **一条查询**，绝不是每会话一条（api.md §1.7 / 存储 delta spec）。
 */
export function listTagVocabulary(
  db: Database,
): Array<{ tag: string; count: number }> {
  return cachedStmt(db, TAG_VOCABULARY_SQL).all() as Array<{ tag: string; count: number }>;
}
