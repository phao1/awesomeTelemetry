import type { OpenCodePart } from '../src/adapters/opencode.js';
import { opencodeAdapter } from '../src/adapters/opencode.js';
import { openReadonly } from '../server/storage/db.js';
import { makeSqliteScanner } from './scanner-utils.js';

interface OpenCodeDbMessageRow {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  time: string | { created?: number; completed?: number };
  model: string | null;
  tokens: string | Record<string, unknown> | null;
  error: string | null;
  parentID: string | null;
  info: string | null;
}

interface OpenCodeDbPartRow {
  messageID: string;
  type: string;
  text: string | null;
  tool: string | null;
  state: string | Record<string, unknown> | null;
}

function parseJson<T>(value: string | T | null | undefined): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** REQ-010：读取 OpenCode 系 SQLite（message 表 join part 表）。 */
export function readOpenCodeDb(dbPath: string): {
  session: { id?: string; title?: string; directory?: string; time?: { created?: number; updated?: number } };
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    sessionID: string;
    time?: { created?: number; completed?: number };
    model?: string | null;
    tokens?: Record<string, unknown> | null;
    error?: string | null;
    content?: OpenCodePart[];
  }>;
} {
  const db = openReadonly(dbPath);
  try {
    const sessionRows = db
      .prepare('SELECT id, title, version, time, directory FROM session ORDER BY rowid LIMIT 1')
      .all() as Array<Record<string, unknown>>;
    const messages = db
      .prepare(
        'SELECT id, sessionID, role, time, model, tokens, error, parentID, info FROM message ORDER BY rowid',
      )
      .all() as OpenCodeDbMessageRow[];
    const parts = db
      .prepare(
        'SELECT messageID, type, text, tool, state FROM part ORDER BY rowid',
      )
      .all() as OpenCodeDbPartRow[];

    const partsByMessage = new Map<string, OpenCodePart[]>();
    for (const part of parts) {
      const list = partsByMessage.get(part.messageID) ?? [];
      list.push({
        type: part.type,
        text: part.text ?? undefined,
        tool: part.tool ?? undefined,
        state: parseJson<OpenCodePart['state']>(part.state) ?? undefined,
      });
      partsByMessage.set(part.messageID, list);
    }

    const session = sessionRows[0] ?? {};
    return {
      session: {
        id: typeof session.id === 'string' ? session.id : undefined,
        title: typeof session.title === 'string' ? session.title : undefined,
        directory: typeof session.directory === 'string' ? session.directory : undefined,
        time: parseJson(session.time) ?? undefined,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        sessionID: m.sessionID,
        time: parseJson<{ created?: number; completed?: number }>(m.time) ?? undefined,
        model: m.model,
        tokens: parseJson<Record<string, unknown>>(m.tokens),
        error: m.error,
        content: partsByMessage.get(m.id) ?? [],
      })),
    };
  } finally {
    db.close();
  }
}

export const opencodeScanner = makeSqliteScanner('opencode', (dbPath, filePath) => {
  const sample = readOpenCodeDb(dbPath);
  return opencodeAdapter.normalize(
    { sourceAgent: 'OpenCode', session: sample.session, events: sample.messages },
    filePath,
  );
});
