import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { ProviderKey, TraceStatus } from '../../src/core/trace-types.js';
import { initSchema } from './schema.js';
import { listSessions } from './query-engine.js';
import {
  ANNOTATION_MAX_TAGS,
  ANNOTATION_NOTE_MAX_CHARS,
  ANNOTATION_TAG_MAX_CHARS,
  AnnotationBoundError,
  AnnotationSessionNotFoundError,
  assertValidNote,
  assertValidTag,
  listTagVocabulary,
  normaliseTags,
  readAnnotations,
  writeAnnotations,
} from './annotations.js';

type Db = InstanceType<typeof Database>;

/** 镜像生产 openWritable：FK 级联依赖 foreign_keys = ON。 */
function newDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function insertSession(
  db: Db,
  id: string,
  over: {
    provider?: ProviderKey;
    status?: TraceStatus;
    sourcePath?: string;
  } = {},
): void {
  db.prepare(
    `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status, cwd, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    over.provider ?? ('codex' as ProviderKey),
    'Codex',
    `t ${id}`,
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T00:01:00.000Z',
    over.status ?? ('success' as TraceStatus),
    '/tmp',
    over.sourcePath ?? `/tmp/${id}.jsonl`,
  );
}

function annotationCount(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM session_annotations').get() as { c: number }).c;
}

describe('Session annotations 存储（add-trajectory-inspector D13）', () => {
  it('未注解会话：读返回 空标签 / null 备注 / null 时间戳，且不创建行', () => {
    const db = newDb();
    insertSession(db, 's1');

    const before = annotationCount(db);
    const a = readAnnotations(db, 's1');
    expect(a).toEqual({ sessionKey: 's1', tags: [], note: null, updatedAt: null });
    expect(annotationCount(db)).toBe(before); // 读不产生副作用
    db.close();
  });

  it('往返：规范化 trim → lowercase → 去重 → 升序；时间戳为 ISO 8601 UTC', () => {
    const db = newDb();
    insertSession(db, 's1');

    const written = writeAnnotations(db, 's1', {
      tags: ['  Refactor  ', 'refactor', 'PERF', '  Résumé  '],
      note: '第一轮注解',
    });

    expect(written.tags).toEqual(['perf', 'refactor', 'résumé']);
    expect(written.note).toBe('第一轮注解');
    expect(written.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const read = readAnnotations(db, 's1');
    expect(read.tags).toEqual(['perf', 'refactor', 'résumé']);
    expect(read.note).toBe('第一轮注解');
    expect(read.updatedAt).toBe(written.updatedAt);
    db.close();
  });

  it('部分更新：缺省键不动（只写 tags；只写 note）', () => {
    const db = newDb();
    insertSession(db, 's1');
    writeAnnotations(db, 's1', { tags: ['a', 'b'], note: 'note-1' });

    const tagsOnly = writeAnnotations(db, 's1', { tags: ['c'] });
    expect(tagsOnly.tags).toEqual(['c']);
    expect(tagsOnly.note).toBe('note-1'); // note 未提供 → 不动

    const noteOnly = writeAnnotations(db, 's1', { note: 'note-2' });
    expect(noteOnly.tags).toEqual(['c']); // tags 未提供 → 不动
    expect(noteOnly.note).toBe('note-2');
    db.close();
  });

  it('清空：tags: [] 清空标签，note: null 清空备注', () => {
    const db = newDb();
    insertSession(db, 's1');
    writeAnnotations(db, 's1', { tags: ['a', 'b'], note: 'note-1' });

    const clearedTags = writeAnnotations(db, 's1', { tags: [] });
    expect(clearedTags.tags).toEqual([]);
    expect(clearedTags.note).toBe('note-1');

    const clearedNote = writeAnnotations(db, 's1', { note: null });
    expect(clearedNote.tags).toEqual([]);
    expect(clearedNote.note).toBeNull();
    db.close();
  });

  it('每次成功写刷新 updated_at', () => {
    const db = newDb();
    insertSession(db, 's1');
    const first = writeAnnotations(db, 's1', { tags: ['a'] });
    const second = writeAnnotations(db, 's1', { note: 'x' });
    expect(second.updatedAt).not.toBeNull();
    expect(Date.parse(second.updatedAt ?? '') >= Date.parse(first.updatedAt ?? '')).toBe(true);
    db.close();
  });

  it('边界：32 个标签 / 64 字符标签 / 8192 字符备注恰好通过', () => {
    const db = newDb();
    insertSession(db, 's1');
    const tags = Array.from({ length: ANNOTATION_MAX_TAGS }, (_, i) => `tag-${String(i).padStart(2, '0')}`);
    const longTag = 'x'.repeat(ANNOTATION_TAG_MAX_CHARS);
    const note = 'n'.repeat(ANNOTATION_NOTE_MAX_CHARS);

    const atCap = writeAnnotations(db, 's1', { tags });
    expect(atCap.tags).toHaveLength(ANNOTATION_MAX_TAGS);
    // 64 字符标签恰好通过（替换而非追加，避免超 32 上限）
    const withLong = writeAnnotations(db, 's1', { tags: [longTag] });
    expect(withLong.tags).toEqual([longTag]);
    const withLongNote = writeAnnotations(db, 's1', { note });
    expect(withLongNote.note).toHaveLength(ANNOTATION_NOTE_MAX_CHARS);
    db.close();
  });

  it('边界违反：33 标签 / 65 字符 / 非法字符 / 空标签 / 8193 字符备注 → typed error，不落库', () => {
    const db = newDb();
    insertSession(db, 's1');
    writeAnnotations(db, 's1', { tags: ['keep'], note: 'keep-note' });

    const cases: Array<{ label: string; update: Parameters<typeof writeAnnotations>[2] }> = [
      { label: '33 个标签', update: { tags: Array.from({ length: ANNOTATION_MAX_TAGS + 1 }, (_, i) => `t${i}`) } },
      { label: '65 字符标签', update: { tags: ['x'.repeat(ANNOTATION_TAG_MAX_CHARS + 1)] } },
      { label: '含空格字符', update: { tags: ['has space'] } },
      { label: '含标点字符', update: { tags: ['tag!'] } },
      { label: '空白标签', update: { tags: ['   '] } },
      { label: '空标签', update: { tags: [''] } },
      {
        label: '8193 字符备注',
        update: { note: 'n'.repeat(ANNOTATION_NOTE_MAX_CHARS + 1) },
      },
    ];

    for (const c of cases) {
      expect(() => writeAnnotations(db, 's1', c.update), c.label).toThrow(AnnotationBoundError);
    }
    // 任何违反都不得持久化任何内容
    const read = readAnnotations(db, 's1');
    expect(read.tags).toEqual(['keep']);
    expect(read.note).toBe('keep-note');
    db.close();
  });

  it('unicode 标签往返：résumé / 日本語 / ключ', () => {
    const db = newDb();
    insertSession(db, 's1');
    const a = writeAnnotations(db, 's1', {
      tags: ['Résumé', '日本語', 'Ключ', '  Résumé  '],
    });
    // 升序 = 码元序（确定性、无 locale 依赖）：r < к < 日
    expect(a.tags).toEqual(['résumé', 'ключ', '日本語']);
    expect(readAnnotations(db, 's1').tags).toEqual(['résumé', 'ключ', '日本語']);
    db.close();
  });

  it('unknown key：写抛 AnnotationSessionNotFoundError，读返回空形状且不创建行', () => {
    const db = newDb();
    insertSession(db, 's1');

    expect(() => writeAnnotations(db, 'missing', { tags: ['a'] })).toThrow(
      AnnotationSessionNotFoundError,
    );
    expect(annotationCount(db)).toBe(0);
    expect(readAnnotations(db, 'missing')).toEqual({
      sessionKey: 'missing',
      tags: [],
      note: null,
      updatedAt: null,
    });
    expect(annotationCount(db)).toBe(0);
    db.close();
  });

  it('级联删除：删除会话后注解行被 FK 移除', () => {
    const db = newDb();
    insertSession(db, 's1');
    writeAnnotations(db, 's1', { tags: ['a'], note: 'n' });
    expect(annotationCount(db)).toBe(1);

    db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');
    expect(annotationCount(db)).toBe(0);
    db.close();
  });

  it('标签词表：count 降序、标签升序，一条查询产出', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertSession(db, 's2');
    insertSession(db, 's3');
    writeAnnotations(db, 's1', { tags: ['perf', 'refactor'] });
    writeAnnotations(db, 's2', { tags: ['perf', 'api'] });
    writeAnnotations(db, 's3', { tags: ['refactor'] });
    insertSession(db, 's4'); // 未注解

    const vocab = listTagVocabulary(db);
    expect(vocab).toEqual([
      { tag: 'perf', count: 2 },
      { tag: 'refactor', count: 2 },
      { tag: 'api', count: 1 },
    ]);
    db.close();
  });

  it('词表与规范化直接函数：normaliseTags / assertValidTag / assertValidNote', () => {
    expect(normaliseTags(['  B  ', 'b', 'A', 'a', 'A'])).toEqual(['a', 'b']);
    expect(() => assertValidTag('   ', 0)).toThrow(AnnotationBoundError);
    expect(() => assertValidTag('ok-tag', 0)).not.toThrow();
    expect(() => assertValidNote('n'.repeat(ANNOTATION_NOTE_MAX_CHARS + 1))).toThrow(
      AnnotationBoundError,
    );
  });

  it('OR 过滤：两标签命中任一携带方（列表 join 一次评估）', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertSession(db, 's2');
    insertSession(db, 's3');
    insertSession(db, 's4');
    writeAnnotations(db, 's2', { tags: ['perf'] });
    writeAnnotations(db, 's3', { tags: ['refactor'] });
    writeAnnotations(db, 's4', { tags: ['perf', 'other'] });

    const r = listSessions(db, { dataSource: 'scan', tags: ['perf', 'refactor'] });
    const ids = new Set(r.items.map((i) => i.id));
    expect(ids.has('s2')).toBe(true);
    expect(ids.has('s3')).toBe(true);
    expect(ids.has('s4')).toBe(true);
    expect(ids.has('s1')).toBe(false); // 未注解不命中
    expect(r.total).toBe(3);

    // 行上带 tags 数组；未注解行为空数组
    const byId = new Map(r.items.map((i) => [i.id, i.tags]));
    expect(byId.get('s2')).toEqual(['perf']);
    expect(byId.get('s3')).toEqual(['refactor']);
    expect(byId.get('s4')).toEqual(['other', 'perf']);
    db.close();
  });
});
