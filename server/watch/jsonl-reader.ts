import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs';

const PROBE = 4096;

/** 首 4KB 的 SHA1，用于检测文件被整体重写（REQ-008 回退条件）。 */
export function headHash(path: string): string {
  const st = statSync(path);
  const len = Math.min(PROBE, st.size);
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(len);
    readSync(fd, head, 0, len, 0);
    return createHash('sha1').update(head).digest('hex');
  } finally {
    closeSync(fd);
  }
}

export interface JsonlReadResult {
  rows: unknown[];
  /** 最后一条完整行之后的字节位置，可直接作为下次续读 startOffset。 */
  endOffset: number;
  /** true 表示因截断或头部变化回退到全量。 */
  fellBack: boolean;
}

export interface JsonlReadOptions {
  /** 上次扫描时的首 4KB hash；不一致说明文件被重写，回退全量。 */
  prevHeadHash?: string;
}

/**
 * REQ-008：流式逐行解析（MUST NOT 正则 split 整个文件）。
 * - 文件被截断（file_size < startOffset）→ 回退 offset=0
 * - 首 4KB hash 变化 → 回退 offset=0
 * - 末尾未换行的部分行不计入（append-only 尾部读语义）
 */
export async function readJsonlFrom(
  path: string,
  startOffset: number,
  opts: JsonlReadOptions = {},
): Promise<JsonlReadResult> {
  const st = statSync(path);
  let offset = Math.max(startOffset, 0);
  let fellBack = false;

  if (st.size < offset) {
    offset = 0;
    fellBack = true;
  }
  if (!fellBack && opts.prevHeadHash !== undefined) {
    const current = headHash(path);
    if (current !== opts.prevHeadHash) {
      offset = 0;
      fellBack = true;
    }
  }

  const rows: unknown[] = [];
  let absoluteBytes = offset;
  let pending = '';

  const stream = createReadStream(path, {
    start: offset,
    end: st.size - 1,
    encoding: 'utf8',
  });

  for await (const chunk of stream) {
    pending += chunk;
    let nl: number;
    while ((nl = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, nl);
      absoluteBytes += Buffer.byteLength(line, 'utf8') + 1;
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
      try {
        rows.push(JSON.parse(trimmed));
      } catch {
        // 坏行跳过，endOffset 仍正确推进
      }
      pending = pending.slice(nl + 1);
    }
  }

  return { rows, endOffset: absoluteBytes, fellBack };
}
