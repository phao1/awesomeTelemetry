import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { packBinary } from './pack-binary.mjs';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('REQ-008 pack-binary', () => {
  it('生成 .ps1（UTF-8）与 .sh，不生成 .bat；复制 dist/server-dist/bin', () => {
    const out = mkdtempSync(join(tmpdir(), 'pack-binary-'));
    tempDirs.push(out);
    packBinary({ root: process.cwd(), outDir: out, includeNodeModules: false });

    expect(existsSync(join(out, 'dist'))).toBe(true);
    expect(existsSync(join(out, 'server-dist', 'cli.js'))).toBe(true);
    expect(existsSync(join(out, 'bin', 'agent-observe.js'))).toBe(true);
    expect(existsSync(join(out, 'agent-observe.ps1'))).toBe(true);
    expect(existsSync(join(out, 'agent-observe.sh'))).toBe(true);
    expect(existsSync(join(out, 'agent-observe.bat'))).toBe(false);
    const ps1 = readFileSync(join(out, 'agent-observe.ps1'), 'utf8');
    expect(ps1).toContain('UTF-8');
    expect(ps1).toContain('agent-observe.js');
  });

  it('缺少构建产物时抛错', () => {
    const out = mkdtempSync(join(tmpdir(), 'pack-missing-'));
    tempDirs.push(out);
    const fakeRoot = mkdtempSync(join(tmpdir(), 'pack-root-'));
    tempDirs.push(fakeRoot);
    expect(() => packBinary({ root: fakeRoot, outDir: out, includeNodeModules: false })).toThrow(/缺少构建产物/);
  });
});
