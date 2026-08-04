import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// P-3：Frida 需要 Windows + Trae 进程，macOS 无法端到端验证。spawn 异步，不用 spawnSync（REQ-013/G11.6）。

export interface FridaCaptureData {
  pid: number;
  model: string | null;
  sessionId: string | null;
  jsonData: string;
}

/** 解析 frida 脚本 stdout 的结构化标记（[NEW CHAT DATA] / [HEX] / [END]）。 */
export function parseFridaOutput(stdout: string): FridaCaptureData[] {
  const captures: FridaCaptureData[] = [];
  const blocks = stdout.split('[NEW CHAT DATA]');
  for (const block of blocks.slice(1)) {
    const end = block.indexOf('[END]');
    const jsonData = (end >= 0 ? block.slice(0, end) : block).trim();
    if (jsonData !== '') {
      captures.push({ pid: 0, model: null, sessionId: null, jsonData });
    }
  }
  return captures;
}

/** REQ-015：monitor 模式（持续监听），spawn 异步。 */
export function runFridaMonitor(
  pid: number,
  scriptPath: string,
  onData: (capture: FridaCaptureData) => void,
): { child: ReturnType<typeof spawn> } {
  const child = spawn('frida', ['-p', String(pid), '-l', scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const captures = parseFridaOutput(buffer);
    if (captures.length > 0) {
      buffer = '';
      for (const capture of captures) {
        onData({ ...capture, pid });
      }
    }
  });
  return { child };
}

/** REQ-014：自动发现 Trae target（Windows tasklist + 探测脚本，骨架）。 */
export async function discoverFridaTarget(): Promise<number> {
  if (process.platform !== 'win32') {
    throw new Error('FRIDA_TARGET_NOT_FOUND: Frida 捕获仅支持 Windows');
  }
  const script = join(process.cwd(), 'scripts', 'frida-check-module.js');
  if (!existsSync(script)) {
    throw new Error('FRIDA_TARGET_NOT_FOUND: 探测脚本缺失');
  }
  return new Promise((resolve, reject) => {
    const child = spawn('tasklist', ['/FI', 'IMAGENAME eq Trae CN.exe', '/FO', 'CSV']);
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('exit', (code) => {
      if (code === 0) {
        const match = /"(\d+)"/.exec(out);
        if (match !== null) {
          resolve(Number(match[1]));
          return;
        }
      }
      reject(new Error('FRIDA_TARGET_NOT_FOUND'));
    });
    child.on('error', () => reject(new Error('FRIDA_TARGET_NOT_FOUND')));
  });
}
