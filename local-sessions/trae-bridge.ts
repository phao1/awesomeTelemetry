import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fingerprintSqliteWithWal } from '../server/watch/fingerprint.js';

export interface TraeBridgeOptions {
  keyPath: string | null;
  pythonBin?: string;
  scriptPath?: string;
  cacheDir?: string;
  timeoutMs?: number;
}

export type TraeDecryptResult =
  | { ok: true; decryptedPath: string }
  | { ok: false; code: 'TRAE_KEY_MISSING' | 'DECRYPT_FAILED'; message?: string };

const CACHE_TTL_MS = 30_000;

/**
 * REQ-012：Trae SQLCipher 解密走 spawn + Promise，绝不 spawnSync；
 * 结果按「DB + -wal 指纹 + keyPath」缓存，指纹未变且 < 30s 直接复用（不 spawn）。
 */
export async function decryptTraeDb(
  dbPath: string,
  opts: TraeBridgeOptions,
): Promise<TraeDecryptResult> {
  if (opts.keyPath === null || opts.keyPath === '') {
    return { ok: false, code: 'TRAE_KEY_MISSING' };
  }
  const cacheDir = opts.cacheDir ?? join(tmpdir(), 'agent-observe-trae');
  mkdirSync(cacheDir, { recursive: true });
  const fp = fingerprintSqliteWithWal(dbPath);
  // 缓存键 = 源库指纹 + keyPath 摘要：密钥轮换后不得复用旧解密结果
  const keyDigest = createHash('sha1').update(opts.keyPath ?? '').digest('hex').slice(0, 12);
  const cachePath = join(cacheDir, `${fp.hash}.${keyDigest}.db`);

  if (existsSync(cachePath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs;
    if (age < CACHE_TTL_MS) {
      return { ok: true, decryptedPath: cachePath };
    }
  }

  const scriptPath = opts.scriptPath ?? join(process.cwd(), 'scripts', 'trae-extract-key.py');
  // Windows 惯例是 python / py，macOS/Linux 是 python3；可被配置覆盖
  const pythonBin = opts.pythonBin ?? (process.platform === 'win32' ? 'python' : 'python3');
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return new Promise<TraeDecryptResult>((resolve) => {
    const child = spawn(
      pythonBin,
      [scriptPath, '--decrypt', dbPath, '--key', opts.keyPath!, '--out', cachePath],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        // REQ-007：Windows 默认 cp936/gbk，强制 UTF-8 输出
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, code: 'DECRYPT_FAILED', message: `Decrypt timed out (>${timeoutMs}ms)` });
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: 'DECRYPT_FAILED', message: err.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(cachePath)) {
        resolve({ ok: true, decryptedPath: cachePath });
      } else {
        resolve({
          ok: false,
          code: 'DECRYPT_FAILED',
          message: stderr.trim() !== '' ? stderr.trim() : `python exited with code ${String(code)}`,
        });
      }
    });
  });
}
