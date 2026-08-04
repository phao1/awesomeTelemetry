/// <reference types="node" />

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesDir = join(process.cwd(), 'src', 'styles');
const tokensPath = join(stylesDir, 'tokens.css');

function cssFiles(): string[] {
  const out: string[] = [];
  const stack = [stylesDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && entry.name.endsWith('.css') && path !== tokensPath) {
        out.push(path);
      }
    }
  }
  return out;
}

interface TokenBlock {
  selector: string;
  tokens: Map<string, string>;
}

function parseTokenBlocks(source: string): TokenBlock[] {
  const blocks: TokenBlock[] = [];
  const blockRe = /(^|\n)(:root|\[data-theme="light"\])[^{]*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(source)) !== null) {
    const selector = match[2]!;
    const body = match[3]!;
    const tokens = new Map<string, string>();
    const lineRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let line: RegExpExecArray | null;
    while ((line = lineRe.exec(body)) !== null) {
      tokens.set(line[1]!, line[2]!.trim());
    }
    blocks.push({ selector, tokens });
  }
  return blocks;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`非法 hex: ${hex}`);
  }
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 相对亮度（0–1），自己算不引库（契约 §9 T4）。 */
function luminance(hex: string): number {
  const channels = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const r = channels[0]!;
  const g = channels[1]!;
  const b = channels[2]!;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** CIE76 ΔE（契约 §9 T5）。 */
function deltaE(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

describe('Design Tokens 契约断言（design-tokens.md §9）', () => {
  const blocks = parseTokenBlocks(readFileSync(tokensPath, 'utf8'));
  const dark = blocks.find((b) => b.selector === ':root');
  const light = blocks.find((b) => b.selector === '[data-theme="light"]');

  it('T1: :root 与 [data-theme="light"] 的 token 键集合完全相等', () => {
    expect(dark).toBeDefined();
    expect(light).toBeDefined();
    expect([...light!.tokens.keys()].sort()).toEqual([...dark!.tokens.keys()].sort());
  });

  it('T2: tokens.css 之外无字面量 hex 颜色', () => {
    for (const path of cssFiles()) {
      const source = readFileSync(path, 'utf8');
      const hits = source.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
      expect(hits, relative(stylesDir, path)).toEqual([]);
    }
  });

  it('T3: tokens.css 之外无非 var() 的 px 间距（0px/1px 描边除外）', () => {
    for (const path of cssFiles()) {
      const source = readFileSync(path, 'utf8');
      const hits: string[] = source.match(/\b\d+px\b/g) ?? [];
      const illegal = hits.filter((h: string) => h !== '0px' && h !== '1px');
      expect(illegal, relative(stylesDir, path)).toEqual([]);
    }
  });

  it('T4: §2.7 全部对比度组合在两套主题下达标（WCAG 相对亮度）', () => {
    for (const [theme, block] of [
      ['dark', dark!],
      ['light', light!],
    ] as const) {
      const t = block.tokens;
      const get = (name: string): string => {
        const value = t.get(name);
        expect(value, `${theme} 缺少 ${name}`).toBeDefined();
        return value!;
      };
      const canvas = get('--canvas-default');
      expect(contrast(get('--fg-default'), canvas), `${theme} fg-default`).toBeGreaterThanOrEqual(12);
      expect(contrast(get('--fg-muted'), canvas), `${theme} fg-muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(get('--fg-subtle'), canvas), `${theme} fg-subtle`).toBeGreaterThanOrEqual(3);
      for (const group of ['accent', 'success', 'attention', 'danger', 'done', 'neutral']) {
        expect(contrast(get(`--${group}-fg`), canvas), `${theme} ${group}-fg`).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(get('--fg-on-emphasis'), get(`--${group}-emphasis`)),
          `${theme} fg-on-emphasis on ${group}-emphasis`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const phase of ['understand', 'plan', 'implement', 'debug', 'verify', 'report']) {
        expect(contrast(get(`--phase-${phase}`), canvas), `${theme} phase-${phase}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('T5: 6 个 phase 色两两 ΔE > 15（CIE76），两套主题', () => {
    const phases = ['understand', 'plan', 'implement', 'debug', 'verify', 'report'];
    for (const [theme, block] of [
      ['dark', dark!],
      ['light', light!],
    ] as const) {
      const colors = phases.map((p) => block.tokens.get(`--phase-${p}`)!);
      for (let i = 0; i < colors.length; i += 1) {
        for (let j = i + 1; j < colors.length; j += 1) {
          const d = deltaE(colors[i]!, colors[j]!);
          expect(d, `${theme} ${phases[i]} vs ${phases[j]}`).toBeGreaterThan(15);
        }
      }
    }
  });

  it('tokens.css 只含 :root / [data-theme="light"] 两个块', () => {
    expect(blocks).toHaveLength(2);
  });

  it('CSS 文件总量存在（供 REQ-010 预算审计）', () => {
    const total = cssFiles().reduce((sum, p) => sum + statSync(p).size, 0);
    expect(total).toBeGreaterThan(0);
  });
});
