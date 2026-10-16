import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { readCaptureBodies, writeCaptureBodies, writeCaptureTransport } from './capture-storage.js';
import type { ProxyCaptureBodies } from '../../src/core/trace-types.js';

describe('capture body reference index', () => {
  it('adds v15 deletion identity without rewriting v14 evidence, preserves tombstones after deletion and uses indexed lookups', () => {
    const db = new Database(':memory:'); initSchema(db);
    try {
      db.exec("INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES('preserved','POST','/','h','2026-10-15T00:00:00.000Z')");
      const original: ProxyCaptureBodies = { request: { id: 'request-original', bytes: 99, sha256: 'kept', status: 'complete', error: null }, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: { 'set-cookie': ['retained=one', 'retained=two'] }, transport: { version: 1, state: 'network_error', error: 'ECONNRESET', requestEnded: true, responseEnded: false, statusCode: 200 } };
      writeCaptureBodies(db, 1, original);
      db.exec("DROP TABLE proxy_capture_tombstones; DROP INDEX idx_proxy_started_utc; UPDATE _meta SET value='14' WHERE key='schema_version'");
      initSchema(db); initSchema(db);
      expect(readCaptureBodies(db, 1)).toEqual(original);
      expect(db.prepare('SELECT request_id FROM proxy_requests').all()).toEqual([{ request_id: 'preserved' }]);
      expect(db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({ value: '17' });
      db.prepare('INSERT INTO proxy_capture_tombstones(request_id,request_body_id,response_body_id,deleted_at) VALUES(?,?,?,?)').run('preserved', 'request-original', 'response-original', '2026-10-16T00:00:00.000Z');
      db.exec('DELETE FROM proxy_requests'); initSchema(db);
      expect(db.prepare('SELECT request_id,request_body_id,response_body_id,deleted_at FROM proxy_capture_tombstones').all()).toEqual([{ request_id: 'preserved', request_body_id: 'request-original', response_body_id: 'response-original', deleted_at: '2026-10-16T00:00:00.000Z' }]);
      const exact = JSON.stringify(db.prepare('EXPLAIN QUERY PLAN SELECT request_id FROM proxy_capture_tombstones WHERE request_id=? AND request_body_id=? AND response_body_id=?').all('preserved', 'request-original', 'response-original'));
      expect(exact).toContain('PRIMARY KEY'); expect(exact).not.toContain('SCAN proxy_capture_tombstones');
      const expiry = JSON.stringify(db.prepare('EXPLAIN QUERY PLAN SELECT id FROM proxy_requests WHERE julianday(started_at)<julianday(?) LIMIT 1').all('2026-10-16T00:00:00.000Z'));
      expect(expiry).toContain('idx_proxy_started_utc'); expect(expiry).not.toContain('USE TEMP B-TREE');
    } finally { db.close(); }
  });
  it('round-trips refs, original response headers and preview flags without duplicating bodies', () => {
    const db = new Database(':memory:'); initSchema(db);
    db.prepare("INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES('r','POST','/','h','2026-10-15T00:00:00.000Z')").run();
    const value: ProxyCaptureBodies = {
      request: { id: 'a', bytes: 100_000_000, sha256: 'digest', status: 'complete', error: null },
      response: null, requestPreviewTruncated: true, responsePreviewTruncated: false,
      responseHeaders: { 'set-cookie': ['original-one', 'original-two'], 'x-test': 'original' },
    };
    writeCaptureBodies(db, 1, value);
    writeCaptureBodies(db, 1, value);
    expect(readCaptureBodies(db, 1)).toEqual(value);
    expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_bodies').get()).toEqual({ n: 1 });
    expect(readCaptureBodies(db, 2)).toEqual({ request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
    db.close();
  });

  it('creates v11 capture index additively while preserving v10 proxy data', () => {
    const db = new Database(':memory:'); initSchema(db);
    db.exec("INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES('r','POST','/','h','2026-10-15T00:00:00.000Z')");
    db.exec("DROP TABLE proxy_capture_bodies; UPDATE _meta SET value='10' WHERE key='schema_version'");
    initSchema(db); initSchema(db);
    expect(db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({ value: '17' });
    expect(db.prepare('SELECT request_id FROM proxy_requests').all()).toEqual([{ request_id: 'r' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_bodies').get()).toEqual({ n: 0 });
    db.close();
  });

  it('adds v13 processing outcomes without rewriting existing refs or confusing analysis failure with original loss', () => {
    const db = new Database(':memory:'); initSchema(db);
    db.exec("INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES('r','POST','/','h','2026-10-15T00:00:00.000Z')");
    const value: ProxyCaptureBodies = { request: { id: 'original', bytes: 25, sha256: 'digest', status: 'complete', error: null }, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} };
    writeCaptureBodies(db, 1, value);
    db.exec("DROP TABLE proxy_capture_processing; UPDATE _meta SET value='12' WHERE key='schema_version'");
    initSchema(db); initSchema(db);
    expect(readCaptureBodies(db, 1)).toEqual(value);
    expect(db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({ value: '17' });
    writeCaptureBodies(db, 1, { ...value, processing: { version: 1, status: 'queue_full', error: 'CAPTURE_PROCESSING_QUEUE_FULL' } });
    expect(readCaptureBodies(db, 1)).toEqual({ ...value, processing: { version: 1, status: 'queue_full', error: 'CAPTURE_PROCESSING_QUEUE_FULL' } });
    db.exec('DELETE FROM proxy_requests WHERE id=1');
    expect(db.prepare('SELECT COUNT(*) AS count FROM proxy_capture_processing').get()).toEqual({ count: 0 });
    db.close();
  });
  it('adds v14 transport evidence without backfilling legacy outcomes or changing original/processing records', () => {
    const db = new Database(':memory:'); initSchema(db);
    db.exec("INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES('r','POST','/','h','2026-10-15T00:00:00.000Z')");
    const value: ProxyCaptureBodies = { request: null, response: { id: 'preserved', bytes: 99, sha256: 'digest', status: 'complete', error: null }, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {}, processing: { version: 1, status: 'ok', error: null } };
    writeCaptureBodies(db, 1, value);
    db.exec("DROP TABLE proxy_capture_transport; UPDATE _meta SET value='13' WHERE key='schema_version'");
    initSchema(db); initSchema(db);
    expect(readCaptureBodies(db, 1)).toEqual(value);
    expect(db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({ value: '17' });
    const transport = { version: 1 as const, state: 'http_error' as const, error: 'HTTP_ERROR', requestEnded: true, responseEnded: true, statusCode: 429 };
    writeCaptureTransport(db, 1, transport);
    expect(readCaptureBodies(db, 1)).toEqual({ ...value, transport });
    expect(() => writeCaptureTransport(db, 1, { ...transport, error: 'x'.repeat(513) })).toThrow(RangeError);
    expect(readCaptureBodies(db, 1).transport).toEqual(transport);
    db.exec('DELETE FROM proxy_requests WHERE id=1');
    expect(db.prepare('SELECT COUNT(*) AS count FROM proxy_capture_transport').get()).toEqual({ count: 0 });
    db.close();
  });
});
