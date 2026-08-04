import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, statSync } from 'node:fs';

import type { FileFingerprint } from '../../src/core/trace-types.js';

const PROBE = 4096;

/**
 * REQ-002：只读首尾各 4KB + size + mtime，恒定成本，与文件大小无关。
 * hash = SHA1(size + 首 4KB + 尾 4KB)。
 */
export function fingerprintFile(path: string): FileFingerprint {
  const st = statSync(path);
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(PROBE, st.size));
    readSync(fd, head, 0, head.length, 0);

    const tailLen = Math.min(PROBE, Math.max(0, st.size - head.length));
    const tail = Buffer.alloc(tailLen);
    if (tailLen > 0) {
      readSync(fd, tail, 0, tailLen, st.size - tailLen);
    }

    const h = createHash('sha1');
    h.update(String(st.size));
    h.update(head);
    h.update(tail);
    return { size: st.size, mtimeMs: Math.floor(st.mtimeMs), hash: h.digest('hex') };
  } finally {
    closeSync(fd);
  }
}

/**
 * REQ-002 / G11.15：WAL 型数据源（sqlite / sqlcipher）必须同时覆盖 `-wal` 文件。
 * 指纹 = SHA1 组合串：hash(主DB) + ':' + hash(-wal)；-wal 不存在视为空串。
 */
export function fingerprintSqliteWithWal(dbPath: string): FileFingerprint {
  const main = fingerprintFile(dbPath);
  const walPath = `${dbPath}-wal`;
  let walHash = '';
  try {
    walHash = fingerprintFile(walPath).hash;
  } catch {
    // -wal 尚不存在；主文件指纹已含大小/mtime，新建 -wal 后合并指纹必变
  }
  return {
    size: main.size,
    mtimeMs: main.mtimeMs,
    hash: `${main.hash}:${walHash}`,
  };
}
