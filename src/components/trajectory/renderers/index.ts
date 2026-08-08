import type { ReactNode } from 'react';

/**
 * Tool renderer registry (add-trajectory-inspector design D11 / tasks §7.1).
 *
 * Every renderer is TOTAL: unparseable input returns `{ kind: 'fallback' }`,
 * never throws, and never renders a half-parsed structure as if complete.
 * `RENDER_MAX_CHARS` is enforced BEFORE any parsing (task 7.11) so an
 * oversized body never enters a JSON parser.
 */

/** Result of rendering one side of a tool event (D11, verbatim). */
export type ToolRenderResult = { kind: 'ok'; node: ReactNode } | { kind: 'fallback' };

/** A registered tool renderer (D11, verbatim). `tool` is exact, lowercased. */
export interface ToolRenderer {
  readonly tool: string;
  renderArguments(text: string): ToolRenderResult;
  renderResult(text: string): ToolRenderResult;
}

/** D11 bounds, verbatim. */
export const RENDER_MAX_LINES = 200;
export const RENDER_MAX_CHARS = 100_000;
export const JSON_TREE_DEFAULT_DEPTH = 3;
export const JSON_TREE_ARRAY_PREVIEW = 5;

const rendererRegistry = new Map<string, ToolRenderer>();

/**
 * Register a renderer under its lowercased, trimmed tool name. Overriding a
 * built-in is allowed (AC-7): a renderer registered before the first resolve
 * wins over the built-in seed; a later registration overwrites the map entry.
 */
export function registerToolRenderer(renderer: ToolRenderer): void {
  rendererRegistry.set(renderer.tool.trim().toLowerCase(), renderer);
}

/**
 * Resolve a renderer for a tool name. Matching is exact on the lowercased,
 * trimmed name (D11); unmatched tools fall to the caller's default JSON tree
 * (null). A null tool name resolves to null.
 */
export function resolveToolRenderer(tool: string | null): ToolRenderer | null {
  seedBuiltins();
  if (tool === null) {
    return null;
  }
  const key = tool.trim().toLowerCase();
  return rendererRegistry.get(key) ?? null;
}

/**
 * RENDER_MAX_CHARS gate. MUST run before any parsing in every renderer
 * (task 7.11 / rule 2 of the window). Returns false when the body exceeds
 * the bound so the caller shows raw text plus a truncation notice.
 */
export function withinCharBound(text: string): boolean {
  return text.length <= RENDER_MAX_CHARS;
}

/**
 * RENDER_MAX_LINES gate for line-list renderers. Truncates to
 * RENDER_MAX_LINES and reports how many lines were omitted so the rendered
 * output can say so honestly instead of silently dropping content.
 */
export function limitLines(
  lines: readonly string[],
): { lines: string[]; omitted: number } {
  if (lines.length <= RENDER_MAX_LINES) {
    return { lines: [...lines], omitted: 0 };
  }
  return {
    lines: [...lines.slice(0, RENDER_MAX_LINES)],
    omitted: lines.length - RENDER_MAX_LINES,
  };
}

/**
 * Defensive JSON parse: never throws, returns undefined for unparseable
 * input. Callers treat undefined as fallback.
 */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

let builtinsSeeded = false;

/**
 * Seed the seven built-ins (tasks 7.3–7.9). Lazy so the ESM cycle
 * index.ts <-> renderer modules never observes a half-evaluated module, and
 * idempotent so a renderer registered before the first resolve is preserved.
 */
function seedBuiltins(): void {
  if (builtinsSeeded) {
    return;
  }
  builtinsSeeded = true;
  // The values are imported at the bottom of this module; the bindings are
  // live by the time seedBuiltins() runs (first resolve call).
  const builtins: ToolRenderer[] = [
    readRenderer,
    bashRenderer,
    todowriteRenderer,
    grepRenderer,
    globRenderer,
    editRenderer,
    writeRenderer,
  ];
  for (const renderer of builtins) {
    if (!rendererRegistry.has(renderer.tool)) {
      rendererRegistry.set(renderer.tool, renderer);
    }
  }
}

import { readRenderer } from './read.js';
import { bashRenderer } from './bash.js';
import { todowriteRenderer } from './todowrite.js';
import { grepRenderer } from './grep.js';
import { globRenderer } from './glob.js';
import { editRenderer } from './edit.js';
import { writeRenderer } from './write.js';
