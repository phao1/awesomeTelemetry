/// <reference types="node" />

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const srcRoot = join(process.cwd(), 'src');

function tsFiles(): string[] {
  const out: string[] = [];
  const stack = [srcRoot];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        out.push(path);
      }
    }
  }
  return out;
}

/** 提取所有 catch 块体（含嵌套花括号）。 */
function catchBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  while (true) {
    const match = re.exec(source);
    if (match === null) {
      break;
    }
    let depth = 1;
    let cursor = re.lastIndex;
    while (cursor < source.length && depth > 0) {
      const ch = source[cursor]!;
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      }
      cursor += 1;
    }
    bodies.push(source.slice(re.lastIndex, cursor - 1));
  }
  return bodies;
}

function meaningful(body: string): boolean {
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, '');
  return stripped !== '';
}

describe('REQ-022 / G7.7：禁止空 catch 或只含注释的 catch', () => {
  it('src/**/*.{ts,tsx} 中每个 catch 块都有实际处理（console.error/状态设置/重试）', () => {
    const files = tsFiles();
    expect(files.length).toBeGreaterThan(0);
    let checked = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const bodies = catchBodies(source);
      checked += bodies.length;
      const bad = bodies.filter((body) => !meaningful(body));
      expect(bad, file).toEqual([]);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
