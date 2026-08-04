import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

import { extractUserQuery } from '../src/adapters/workbuddy.js';
import type { ProviderKey } from '../src/core/trace-types.js';

/**
 * REQ-021（T-10）：索引阶段的真实标题与事件数提取。
 * 原则（design.md D1）：JSONL 类**流式读到首条 user 消息即中断**，不读全文、
 * 不走完整 adapter 管线；硬上限 1MB。注入内容用前缀黑名单（D2），
 * 不做语义判断。标题截断 120 字符，取不到时回落 D5。
 */

export const TITLE_MAX_LENGTH = 120;
/** 单个 JSONL 文件索引阶段的读取硬上限（design.md Risk：739MB 级文件也不失控）。 */
export const JSONL_INDEX_READ_CAP = 1024 * 1024;

const READ_CHUNK_BYTES = 64 * 1024;

/**
 * D2：实测注入块的稳定特征。命中即跳过**整条消息**——真实会话中注入块与
 * 用户提问是两条独立 user 消息，逐条跳过即可拿到真正第一句（G5.5）。
 */
const INJECTION_PREFIXES = [
  '# AGENTS.md',
  '<environment_context>',
  '<system-reminder>',
  '<user_instructions>',
  '<codex_internal_context',
  '<recommended_plugins>',
  '<app-context>',
] as const;

export function isInjectedFirstLine(firstLine: string): boolean {
  const normalized = firstLine.trim().toLowerCase();
  return INJECTION_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix.toLowerCase()),
  );
}

/** 从用户消息正文提取标题：首个非空行，截断 120 字符；注入内容返回 null。 */
export function extractTitleFromUserText(text: string): string | null {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (firstLine === undefined) {
    return null;
  }
  if (isInjectedFirstLine(firstLine)) {
    return null;
  }
  return firstLine.length <= TITLE_MAX_LENGTH
    ? firstLine
    : firstLine.slice(0, TITLE_MAX_LENGTH);
}

/** D5：标题取不到时回落 `<provider> session · <本地化的起始时间>`，MUST NOT 回落为文件名。 */
export function fallbackSessionTitle(provider: string, startMs: number): string {
  return `${provider} session · ${new Date(startMs).toLocaleString()}`;
}

export interface JsonlIndexMeta {
  title: string;
  startedAt: string;
  eventCount: number;
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function rowTimestamp(row: Record<string, unknown>): string | null {
  return typeof row.timestamp === 'string' ? row.timestamp : null;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join('\n');
  }
  return '';
}

/** 按 provider 提取「user 角色消息」的正文；非 user 消息返回 null。 */
function userMessageText(row: Record<string, unknown>, provider: ProviderKey): string | null {
  switch (provider) {
    case 'claude':
    case 'codeagent': {
      if (row.type !== 'user') {
        return null;
      }
      const message = row.message as Record<string, unknown> | undefined;
      return message === undefined ? null : contentText(message.content);
    }
    case 'codex': {
      const payload = row.payload as Record<string, unknown> | undefined;
      if (payload === undefined || payload.type !== 'message' || payload.role !== 'user') {
        return null;
      }
      return contentText(payload.content);
    }
    case 'qoder': {
      if (row.role !== 'user') {
        return null;
      }
      return contentText(row.content);
    }
    case 'workbuddy': {
      if (row.role !== 'user') {
        return null;
      }
      const content = typeof row.content === 'string' ? row.content : '';
      return extractUserQuery(content) ?? content;
    }
    default:
      return null;
  }
}

/** REQ-021：JSONL 类事件数来源 = 流式计数的消息行数（直到中断点）。 */
function isMessageRow(row: Record<string, unknown>, provider: ProviderKey): boolean {
  switch (provider) {
    case 'claude':
    case 'codeagent':
      return row.type === 'user' || row.type === 'assistant';
    case 'codex': {
      const payload = row.payload as Record<string, unknown> | undefined;
      return payload?.type === 'message';
    }
    case 'qoder':
    case 'workbuddy':
      return typeof row.role === 'string' && row.role !== '';
    default:
      return false;
  }
}

/**
 * 流式读取 JSONL 头部：分块 readSync（64KB），逐行解析，**拿到首条 user
 * 消息即中断**；上限 1MB。同步实现——索引阶段本身是同步的（REQ-013），
 * 且只发生在启动路径，不在 HTTP 请求路径上（禁令 4）。
 */
export function readJsonlIndexMeta(filePath: string, provider: ProviderKey): JsonlIndexMeta {
  const st = statSync(filePath);
  const fd = openSync(filePath, 'r');
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let position = 0;
  let bytesRead = 0;
  let messageCount = 0;
  let title: string | null = null;
  let firstTimestamp: string | null = null;
  try {
    while (position < st.size && bytesRead < JSONL_INDEX_READ_CAP && title === null) {
      const want = Math.min(
        READ_CHUNK_BYTES,
        st.size - position,
        JSONL_INDEX_READ_CAP - bytesRead,
      );
      const chunk = Buffer.allocUnsafe(want);
      const n = readSync(fd, chunk, 0, want, position);
      if (n <= 0) {
        break;
      }
      position += n;
      bytesRead += n;
      pending += decoder.write(chunk.subarray(0, n));
      let nl: number;
      while (title === null && (nl = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        if (line.trim() === '') {
          continue;
        }
        const row = parseJsonLine(line);
        if (row === undefined) {
          continue;
        }
        if (firstTimestamp === null) {
          firstTimestamp = rowTimestamp(row);
        }
        if (isMessageRow(row, provider)) {
          messageCount += 1;
        }
        if (title === null) {
          const text = userMessageText(row, provider);
          if (text !== null) {
            title = extractTitleFromUserText(text);
          }
        }
      }
    }
  } finally {
    closeSync(fd);
  }
  const startedMs = firstTimestamp !== null ? Date.parse(firstTimestamp) : st.mtimeMs;
  const safeStartMs = Number.isFinite(startedMs) ? startedMs : st.mtimeMs;
  return {
    title: title ?? fallbackSessionTitle(provider, safeStartMs),
    startedAt:
      Number.isFinite(startedMs) && firstTimestamp !== null
        ? firstTimestamp
        : new Date(st.mtimeMs).toISOString(),
    eventCount: messageCount,
  };
}
