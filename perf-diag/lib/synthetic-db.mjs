// 合成 fixture 数据库（P-2 预授权：缺真实厂商数据 → 构造合成数据）。
// 规模对齐参考实现的 B 档：524 会话 / 73,588 event / 最差单会话 9,590 event / 1,820 proxy 行。
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initSchema } from './schema-sql.mjs';

const PROVIDERS = ['claude', 'codex', 'opencode', 'codearts', 'codeagent', 'codeagent2', 'trae', 'qoder', 'workbuddy'];
const PHASES = ['understand', 'plan', 'implement', 'debug', 'verify', 'report'];
const KINDS = ['llm', 'tool', 'file_read', 'file_write', 'bash', 'test', 'agent', 'message'];

export function createSyntheticDb() {
  const dir = mkdtempSync(join(tmpdir(), 'perf-diag-'));
  const path = join(dir, 'perf.sqlite');
  const db = new Database(path);
  initSchema(db);

  const insertSession = db.prepare(
    `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status, cwd,
       message_count, event_count, token_input, token_output, token_reasoning, token_cache_read,
       token_cache_write, token_total, cost_usd, system_prompt, source_path, data_source,
       total_duration_ms, is_subagent, detail_loaded, primary_model, cost_source, duration_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, duration_ms,
       status, actor, tool, input_summary, output_summary, tokens_json, error, model, input_len, output_len)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertProxy = db.prepare(
    `INSERT INTO proxy_requests (request_id, method, url, hostname, response_status, content_type,
       is_streaming, started_at, completed_at, duration_ms, capture_method, ttnet_encrypted,
       system_prompt, system_prompt_len, model, input_tokens, output_tokens, parsed_session_id, parser_route)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const seed = db.transaction(() => {
    const worstSessionEvents = 9590;
    const remainingEvents = 73588 - worstSessionEvents;
    const otherSessionCount = 523;

    // 最差会话（9,590 events）
    insertSession.run(
      'codex-worst', 'codex', 'Codex', 'worst session', '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:10:00.000Z', 'success', '/tmp/worst', 300, worstSessionEvents,
      100000, 80000, 20000, 15000, 5000, 200000, 1.25, 'system prompt',
      '/tmp/worst.jsonl', 'scan', 600000, 0, 1, 'claude-opus-4-8', 'estimated', 'derived',
    );

    const base = Date.parse('2026-08-01T00:00:00.000Z');
    for (let i = 1; i <= worstSessionEvents; i += 1) {
      const kind = KINDS[i % KINDS.length];
      const phase = PHASES[(i / 7) % PHASES.length | 0];
      insertEvent.run(
        'codex-worst', `ev-${i}`, i, kind, phase, `event ${i} title`,
        new Date(base + i * 60).toISOString(), 100 + ((i * 37) % 5000),
        i % 100 === 0 ? 'error' : 'success', 'assistant',
        kind === 'tool' || kind === 'bash' || kind === 'test' ? 'Bash' : null,
        null, null, JSON.stringify({ input: 10, output: 8, reasoning: 2, cacheRead: 1, cacheWrite: 0, total: 21 }),
        i % 100 === 0 ? 'boom' : null,
        kind === 'llm' ? 'claude-opus-4-8' : null, 10, 8,
      );
    }
    // 其余 523 会话（合计 63,998 events）
    for (let s = 0; s < otherSessionCount; s += 1) {
      const provider = PROVIDERS[s % PROVIDERS.length];
      const id = `${provider}-${s}`;
      const perSession = Math.floor(remainingEvents / otherSessionCount);
      const events = s === otherSessionCount - 1
        ? remainingEvents - perSession * (otherSessionCount - 1)
        : perSession;
      const started = new Date(base + s * 60000).toISOString();
      const updated = new Date(Date.parse(started) + events * 60).toISOString();
      insertSession.run(
        id, provider, provider === 'codearts' ? 'CodeArts' : provider,
        `session ${s}`, started, updated, 'success', `/tmp/${id}`,
        Math.floor(events / 3), events, 1000, 800, 200, 150, 50, 2000, 0.05,
        null, `/tmp/${id}.jsonl`, 'scan', events * 60, 0, 0,
        s % 5 === 0 ? 'claude-sonnet-4-6' : s % 3 === 0 ? 'gpt-4o' : null,
        s % 5 === 0 || s % 3 === 0 ? 'estimated' : 'unknown',
        'derived',
      );
      for (let i = 1; i <= events; i += 1) {
        const kind = KINDS[i % KINDS.length];
        insertEvent.run(
          id, `ev-${i}`, i, kind, PHASES[(i / 5) % PHASES.length | 0],
          `event ${i}`, new Date(Date.parse(started) + i * 60).toISOString(),
          100 + ((i * 29) % 4000), 'success', 'assistant',
          kind === 'tool' || kind === 'bash' ? 'Bash' : null,
          null, null, JSON.stringify({ input: 5, output: 4, reasoning: 1, cacheRead: 0, cacheWrite: 0, total: 10 }),
          null,
          kind === 'llm' ? (s % 5 === 0 ? 'claude-sonnet-4-6' : s % 3 === 0 ? 'gpt-4o' : null) : null,
          5, 4,
        );
      }
    }

    // proxy_requests 1,820 行（参考规模），少量带 system_prompt
    for (let i = 0; i < 1820; i += 1) {
      const started = new Date(base + i * 30000).toISOString();
      const prompt = i % 364 === 0 ? `prompt ${i}`.padEnd(200 + (i % 800), 'x') : null;
      insertProxy.run(
        `req-${i}`, 'POST', 'https://api.example.com/v1/chat/completions',
        'api.example.com', 200, 'application/json', i % 3 === 0 ? 1 : 0,
        started, new Date(Date.parse(started) + 2000).toISOString(), 2000,
        'mitm', 0, prompt, prompt === null ? 0 : prompt.length, 'gpt-4o',
        i % 2 === 0 ? 100 : null, i % 2 === 0 ? 80 : null,
        i % 10 === 0 ? `codex-${i % 20}` : null, 'openai',
      );
    }
  });
  seed();
  db.exec('ANALYZE');

  return {
    db,
    path,
    dir,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
