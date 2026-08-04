import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LocalSessionConfig } from '../src/core/trace-types.js';
import {
  DEFAULT_LOCAL_SESSION_CONFIG,
  expandLocalSessionPath,
  loadLocalSessionConfig,
  mergeLocalSessionConfig,
  saveUserConfig,
} from './config.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

describe('REQ-004 三层配置覆盖', () => {
  it('内置默认 → 项目 → 用户，后者覆盖前者', () => {
    const dir = tempDir();
    const projectPath = join(dir, 'project.json');
    const userPath = join(dir, 'user.json');
    writeJson(projectPath, {
      prewarmRecent: 1,
      providers: { codex: { enabled: true, path: '/project/codex' } },
    });
    writeJson(userPath, {
      providers: { codex: { enabled: false, path: '/user/codex' } },
      traeKeyPath: '/keys/trae.key',
    });

    const config = loadLocalSessionConfig({ projectConfigPath: projectPath, userConfigPath: userPath });
    expect(config.prewarmRecent).toBe(1);
    expect(config.providers.codex.enabled).toBe(false);
    expect(config.providers.codex.path).toBe('/user/codex');
    expect(config.traeKeyPath).toBe('/keys/trae.key');
    // 未覆盖的 provider 保持默认
    expect(config.providers.claude.path).toBe(DEFAULT_LOCAL_SESSION_CONFIG.providers.claude.path);
    expect(config.providers.claude.sourceKind).toBe('jsonl');
  });

  it('无配置文件时返回完整默认值', () => {
    const dir = tempDir();
    const config = loadLocalSessionConfig({
      projectConfigPath: join(dir, 'missing.json'),
      userConfigPath: join(dir, 'missing-user.json'),
    });
    expect(config.providers.qoder.enabled).toBe(false); // 默认禁用
    expect(config.prewarmRecent).toBe(0);
    expect(config.providers.trae.watchStrategy).toBe('poll');
  });

  it('mergeLocalSessionConfig 用户层覆盖 project 层', () => {
    const base = DEFAULT_LOCAL_SESSION_CONFIG;
    const merged = mergeLocalSessionConfig(
      base,
      { ...base, prewarmRecent: 5, providers: { ...base.providers, codex: { ...base.providers.codex, path: '/p' } } },
      { ...base, prewarmRecent: undefined as unknown as number, providers: { ...base.providers, codex: { ...base.providers.codex, path: '/u' } } },
    );
    expect(merged.providers.codex.path).toBe('/u');
    expect(merged.prewarmRecent).toBe(5);
  });
});

describe('REQ-005 路径展开', () => {
  it('~ 展开为 home', () => {
    expect(expandLocalSessionPath('~/a/b')).toBe(`${homedir()}/a/b`);
    expect(expandLocalSessionPath('~')).toBe(homedir());
  });

  it('~\\ 展开为 home（Windows 风格）', () => {
    expect(expandLocalSessionPath('~\\Trae CN\\x')).toBe(`${homedir()}${sep}Trae CN${sep}x`);
  });

  it('%VAR% 展开为环境变量，缺失保持原样', () => {
    process.env.CODEX_TEST_FAKE_VAR = '/tmp/fake-dir';
    expect(expandLocalSessionPath('%CODEX_TEST_FAKE_VAR%/sessions')).toBe('/tmp/fake-dir/sessions');
    expect(expandLocalSessionPath('%CODEX_TEST_MISSING_XYZ%/s')).toBe('%CODEX_TEST_MISSING_XYZ%/s');
  });
});

describe('REQ-004 原子写', () => {
  it('saveUserConfig 写入目标文件且无临时残留', () => {
    const dir = tempDir();
    const target = join(dir, 'agent-observe.json');
    const config: LocalSessionConfig = {
      ...DEFAULT_LOCAL_SESSION_CONFIG,
      prewarmRecent: 3,
    };

    saveUserConfig(config, target);
    expect(existsSync(target)).toBe(true);
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as LocalSessionConfig;
    expect(parsed.prewarmRecent).toBe(3);
    expect(readFileSync(target, 'utf8')).toContain('providers');
  });
});
