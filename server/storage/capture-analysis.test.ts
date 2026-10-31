import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureReparseSnapshot } from '../../src/core/trace-types.js';
import { initSchema } from './schema.js';
import { PROXY_CAPTURE_ANALYSIS_COLS } from './columns.js';
import { CaptureAnalysisError, clearCaptureAnalysis, readCaptureAnalysis, writeCaptureAnalysis } from './capture-analysis.js';

const databases: Database.Database[] = [];
function database(): Database.Database {
  const db = new Database(':memory:'); databases.push(db); db.pragma('foreign_keys=ON'); initSchema(db);
  db.prepare('INSERT INTO proxy_requests(id,request_id,method,url,hostname,started_at,request_body,response_body,system_prompt) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(1, 'synthetic-capture', 'POST', '/v1/messages', 'synthetic.invalid', '2026-10-16T00:00:00.000Z', 'original-request', 'original-response', 'original-system');
  return db;
}
function snapshot(): CaptureReparseSnapshot {
  return { parserVersion: 3, metricVersion: 1, sourceFingerprint: 'a'.repeat(64), parsedAt: '2026-10-16T00:00:00.000Z', requestFormat: 'anthropic_messages', state: 'completed',
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0, reasoningTokens: null, nativeTotalTokens: null, totalTokens: 160, accounting: 'anthropic_additive_input' },
    completeness: { complete: true, omittedCount: 0, reasons: [] } };
}
function capture(db: Database.Database): unknown { return db.prepare('SELECT id,request_id,request_body,response_body,system_prompt,input_tokens,output_tokens FROM proxy_requests WHERE id=1').get(); }
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });

describe('metadata-only same-capture analysis snapshots', () => {
  it('round trips an exact bounded snapshot while preserving source rows and without adding captures', () => {
    const db = database(), before = capture(db), value = snapshot();
    expect(readCaptureAnalysis(db, 1)).toBeNull(); writeCaptureAnalysis(db, 1, value);
    expect(readCaptureAnalysis(db, 1)).toEqual(value); expect(capture(db)).toEqual(before);
    const row = db.prepare(`SELECT ${PROXY_CAPTURE_ANALYSIS_COLS} FROM proxy_capture_analysis WHERE proxy_id=1`).get() as Record<string, unknown>;
    expect(Object.keys(row)).toEqual(PROXY_CAPTURE_ANALYSIS_COLS.split(', '));
    expect(JSON.parse(String(row.usage_json))).toEqual(value.usage); expect(JSON.parse(String(row.completeness_json))).toEqual(value.completeness);
    expect(JSON.stringify(row)).not.toMatch(/original-request|original-response|original-system|snapshots|headers|tool/i);
    expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
  });
  it('updates only the same primary-key row and supports later parser/metric versions without assuming currency', () => {
    const db = database(), before = capture(db); writeCaptureAnalysis(db, 1, snapshot());
    const rowid = db.prepare('SELECT rowid FROM proxy_capture_analysis WHERE proxy_id=1').get();
    const updated = { ...snapshot(), parserVersion: 7, metricVersion: 2, sourceFingerprint: 'b'.repeat(64), parsedAt: '2026-10-16T00:00:01Z', state: 'incomplete' as const, completeness: { complete: false, omittedCount: 2, reasons: ['source_partial'] } };
    writeCaptureAnalysis(db, 1, updated); writeCaptureAnalysis(db, 1, updated);
    expect(db.prepare('SELECT rowid FROM proxy_capture_analysis WHERE proxy_id=1').get()).toEqual(rowid);
    expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_analysis').get()).toEqual({ n: 1 });
    expect(readCaptureAnalysis(db, 1)).toEqual(updated); expect(capture(db)).toEqual(before);
  });
  it('retains zero and null as distinct native counts and all frozen formats/states/accounting bases', () => {
    const db = database();
    for (const requestFormat of ['openai_chat', 'openai_responses', 'anthropic_messages', 'unknown'] as const) {
      for (const state of ['completed', 'incomplete', 'failed', 'unknown'] as const) {
        for (const accounting of ['openai_subsets', 'anthropic_additive_input', 'unknown'] as const) {
          const value = snapshot(); Object.assign(value, { requestFormat, state }); Object.assign(value.usage, { inputTokens: null, outputTokens: 0, accounting });
          writeCaptureAnalysis(db, 1, value); expect(readCaptureAnalysis(db, 1)).toEqual(value);
        }
      }
    }
  });
  it('clears only the selected summary idempotently and cascades from metadata expiry', () => {
    const db = database(); writeCaptureAnalysis(db, 1, snapshot()); const before = capture(db);
    clearCaptureAnalysis(db, 1); clearCaptureAnalysis(db, 1); expect(readCaptureAnalysis(db, 1)).toBeNull(); expect(capture(db)).toEqual(before);
    writeCaptureAnalysis(db, 1, snapshot()); db.prepare('DELETE FROM proxy_requests WHERE id=1').run();
    expect(readCaptureAnalysis(db, 1)).toBeNull(); expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_analysis').get()).toEqual({ n: 0 });
    expect(() => writeCaptureAnalysis(db, 99, snapshot())).toThrow(/FOREIGN KEY/);
  });
  it('reuses one explicit SELECT, UPSERT and DELETE statement across calls without body queries', () => {
    const db = database(), prepare = vi.spyOn(db, 'prepare');
    for (let index = 0; index < 3; index += 1) { writeCaptureAnalysis(db, 1, snapshot()); readCaptureAnalysis(db, 1); clearCaptureAnalysis(db, 1); }
    const statements = prepare.mock.calls.map(([sql]) => sql); expect(statements).toHaveLength(3);
    expect(statements.find(sql => sql.startsWith('SELECT'))).toBe(`SELECT ${PROXY_CAPTURE_ANALYSIS_COLS} FROM proxy_capture_analysis WHERE proxy_id=?`);
    expect(statements.some(sql => /ON CONFLICT\(proxy_id\) DO UPDATE/.test(sql))).toBe(true);
    expect(statements.join('\n')).not.toMatch(/SELECT \*|request_body|response_body|system_prompt/);
  });
  it.each([
    ['version zero', { parserVersion: 0 }], ['fractional version', { metricVersion: 1.5 }], ['unsafe version', { parserVersion: Number.MAX_SAFE_INTEGER + 1 }],
    ['bad hash', { sourceFingerprint: 'A'.repeat(64) }], ['invalid format', { requestFormat: 'guessed' }], ['invalid state', { state: 'success' }],
    ['non-ISO date', { parsedAt: 'October 16 2026' }], ['invalid calendar', { parsedAt: '2026-02-30T00:00:00Z' }], ['offset date', { parsedAt: '2026-10-16T00:00:00+08:00' }],
    ['body field', { content: 'must-not-persist' }], ['undefined required', { state: undefined }],
  ])('rejects %s without any partial write or sensitive exception', (_label, patch) => {
    const db = database(); writeCaptureAnalysis(db, 1, snapshot());
    const invalid = { ...snapshot(), ...patch } as CaptureReparseSnapshot;
    expect(() => writeCaptureAnalysis(db, 1, invalid)).toThrow(CaptureAnalysisError);
    expect(() => writeCaptureAnalysis(db, 1, invalid)).toThrow('CAPTURE_REPARSE_LIMIT');
    expect(readCaptureAnalysis(db, 1)).toEqual(snapshot());
  });
  it.each([null, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', undefined])('rejects an invalid count %j while preserving an existing summary', count => {
    const db = database(), value = snapshot(); writeCaptureAnalysis(db, 1, value);
    if (count === null) { value.usage.inputTokens = null; writeCaptureAnalysis(db, 1, value); expect(readCaptureAnalysis(db, 1)?.usage.inputTokens).toBeNull(); return; }
    const invalid = { ...value, usage: { ...value.usage, inputTokens: count } } as CaptureReparseSnapshot;
    expect(() => writeCaptureAnalysis(db, 1, invalid)).toThrow(CaptureAnalysisError); expect(readCaptureAnalysis(db, 1)).toEqual(snapshot());
  });
  it('rejects unknown/missing nested fields, body snapshots and invalid completeness instead of filtering them into apparently valid evidence', () => {
    const db = database(), value = snapshot(); writeCaptureAnalysis(db, 1, value);
    const invalid: unknown[] = [
      { ...value, usage: { ...value.usage, snapshots: [{ value: 'private' }] } }, { ...value, usage: { ...value.usage, accounting: 'add_everything' } },
      { ...value, completeness: { ...value.completeness, raw: 'private' } }, { ...value, completeness: { ...value.completeness, complete: 1 } },
      { ...value, completeness: { ...value.completeness, omittedCount: -1 } }, { ...value, completeness: { ...value.completeness, omittedCount: 0.5 } },
      { ...value, completeness: { ...value.completeness, reasons: Array.from({ length: 33 }, () => 'x') } },
      { ...value, completeness: { ...value.completeness, reasons: ['x'.repeat(129)] } }, { ...value, completeness: { ...value.completeness, reasons: [null] } },
      { ...value, usage: { accounting: 'unknown' } },
    ];
    for (const bad of invalid) expect(() => writeCaptureAnalysis(db, 1, bad as CaptureReparseSnapshot)).toThrow(CaptureAnalysisError);
    expect(readCaptureAnalysis(db, 1)).toEqual(value);
  });
  it('bounds the complete UTF8 snapshot at8192 bytes, preserving exact values rather than truncating', () => {
    const db = database(), value = snapshot(); value.completeness = { complete: false, omittedCount: 32, reasons: Array.from({ length: 32 }, () => 'x'.repeat(128)) };
    let extra = 8192 - Buffer.byteLength(JSON.stringify(value)); expect(extra).toBeGreaterThan(0); expect(extra).toBeLessThan(4096);
    value.completeness.reasons = value.completeness.reasons.map(reason => { const chars = Math.min(extra, reason.length); extra -= chars; return 'é'.repeat(chars) + reason.slice(chars); });
    expect(Buffer.byteLength(JSON.stringify(value))).toBe(8192); writeCaptureAnalysis(db, 1, value); expect(readCaptureAnalysis(db, 1)).toEqual(value);
    const overflow = structuredClone(value); const index = overflow.completeness.reasons.findIndex(reason => reason.includes('x'));
    overflow.completeness.reasons[index] = overflow.completeness.reasons[index]!.replace('x', 'é');
    expect(Buffer.byteLength(JSON.stringify(overflow))).toBe(8193); expect(() => writeCaptureAnalysis(db, 1, overflow)).toThrow(CaptureAnalysisError);
    expect(readCaptureAnalysis(db, 1)).toEqual(value);
  });
  it('fails closed on corrupted persisted metadata without returning body-like fields or raw parse errors', () => {
    const db = database(); writeCaptureAnalysis(db, 1, snapshot());
    db.prepare('UPDATE proxy_capture_analysis SET usage_json=? WHERE proxy_id=1').run('{"content":"secret-body"}');
    expect(() => readCaptureAnalysis(db, 1)).toThrow('CAPTURE_REPARSE_LIMIT');
    db.prepare('UPDATE proxy_capture_analysis SET usage_json=?,completeness_json=? WHERE proxy_id=1').run(JSON.stringify(snapshot().usage), JSON.stringify({ ...snapshot().completeness, reasons: ['x'.repeat(10000)] }));
    expect(() => readCaptureAnalysis(db, 1)).toThrow(CaptureAnalysisError);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid proxy identity %j before issuing SQL', id => {
    const db = database(), prepare = vi.spyOn(db, 'prepare');
    expect(() => readCaptureAnalysis(db, id)).toThrow(CaptureAnalysisError); expect(() => writeCaptureAnalysis(db, id, snapshot())).toThrow(CaptureAnalysisError); expect(() => clearCaptureAnalysis(db, id)).toThrow(CaptureAnalysisError);
    expect(prepare).not.toHaveBeenCalled();
  });
});
