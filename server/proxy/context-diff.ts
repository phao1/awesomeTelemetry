/**
 * Provider-neutral semantic request-context diff (add-request-context-diff).
 *
 * T05 scope (§5.1-§5.7): a pure, deterministic, bounded comparison of two
 * already-normalized request contexts. It never touches the DB, never reads
 * raw bodies, never runs on the forwarding path, and never uses a general
 * quadratic LCS. All algorithms below are linear/bounded and derived from
 * design D7/D8/D9/D13 and the request-context-diff spec.
 */

import type {
  ContextCategoryDiff,
  ContextChangeEntry,
  ContextChangeKind,
  ContextCompleteness,
  ContextDiffCategory,
  ContextDiffSegment,
  ContextEvidenceValue,
  ContextGrowth,
  ContextIndicator,
  RequestContextDiffResponse,
} from '../../src/core/trace-types.js';

import {
  HISTORY_SHRINK_RATIO,
  MAX_CHANGE_ENTRIES,
  MAX_EVIDENCE_EXCERPT_CHARS,
  MAX_INLINE_TEXT_CHARS,
  MAX_RESPONSE_BYTES,
  canonicalSha256,
  canonicalize,
  type JsonValue,
  type NormalizedMessage,
  type NormalizedRequestContext,
  type NormalizedTextBlock,
  type NormalizedTool,
} from './context-normalizer.js';

// ── JSON / evidence helpers ─────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonTypeOf(value: JsonValue): ContextEvidenceValue['jsonType'] {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  return 'object';
}

/**
 * The character basis used for evidence length/excerpts. Strings use their own
 * text; every other JSON value uses its canonical serialization so that object
 * key order does not affect the length.
 */
function evidenceText(value: JsonValue): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(canonicalize(value));
}

/** Bounded evidence value (hash + length + 4096-char excerpts). */
export function evidenceOf(value: JsonValue): ContextEvidenceValue {
  const text = evidenceText(value);
  const charLength = Array.from(text).length;
  const truncated = charLength > MAX_EVIDENCE_EXCERPT_CHARS;
  return {
    jsonType: jsonTypeOf(value),
    sha256: canonicalSha256(value),
    charLength,
    excerptStart: text.slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
    excerptEnd: truncated
      ? Array.from(text).slice(charLength - MAX_EVIDENCE_EXCERPT_CHARS).join('')
      : text.slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
    truncated,
  };
}

// ── design D8: Unicode-code-point inline text diff ───────────────────────────

function codePoints(s: string): string[] {
  return Array.from(s);
}

/**
 * Emit up to four ordered segments (equal prefix, removed middle, added
 * middle, equal suffix) using code-point comparison. Returns `null` segments
 * when either side exceeds the 32,768-character inline limit.
 */
export function inlineDiff(
  before: string,
  after: string,
): { segments: ContextDiffSegment[] | null; truncated: boolean } {
  const bp = codePoints(before);
  const ap = codePoints(after);
  if (bp.length > MAX_INLINE_TEXT_CHARS || ap.length > MAX_INLINE_TEXT_CHARS) {
    return { segments: null, truncated: true };
  }

  let prefix = 0;
  while (prefix < bp.length && prefix < ap.length && bp[prefix] === ap[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < bp.length - prefix &&
    suffix < ap.length - prefix &&
    bp[bp.length - 1 - suffix] === ap[ap.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const segments: ContextDiffSegment[] = [];
  const equalPrefix = bp.slice(0, prefix).join('');
  const removed = bp.slice(prefix, bp.length - suffix).join('');
  const added = ap.slice(prefix, ap.length - suffix).join('');
  const equalSuffix = bp.slice(bp.length - suffix).join('');

  if (equalPrefix) segments.push({ kind: 'equal', text: equalPrefix });
  if (removed) segments.push({ kind: 'removed', text: removed });
  if (added) segments.push({ kind: 'added', text: added });
  if (equalSuffix) segments.push({ kind: 'equal', text: equalSuffix });

  if (segments.length === 0) {
    return { segments: [{ kind: 'equal', text: before }], truncated: false };
  }
  return { segments, truncated: false };
}

/** Text projection of message content (mirrors normalizer `contentText`). */
function contentText(content: JsonValue | null): string {
  if (content === null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        isRecord(block) && typeof block.text === 'string'
          ? block.text
          : JSON.stringify(canonicalize(block as JsonValue)),
      )
      .join('');
  }
  return JSON.stringify(canonicalize(content));
}

function textSegments(
  before: string,
  after: string,
): { segments: ContextDiffSegment[] | null; truncatedReason: 'inline_limit' | null } {
  if (before === after) {
    return { segments: [{ kind: 'equal', text: before }], truncatedReason: null };
  }
  const d = inlineDiff(before, after);
  if (d.truncated) {
    return { segments: null, truncatedReason: 'inline_limit' };
  }
  return { segments: d.segments, truncatedReason: null };
}

// ── completeness helpers ─────────────────────────────────────────────────────

function mergeReasons(list: ContextCompleteness[]): ContextCompleteness['reasons'] {
  const set = new Set<string>();
  for (const c of list) {
    for (const r of c.reasons) set.add(r);
  }
  return [...set] as ContextCompleteness['reasons'];
}

function sumOmitted(list: ContextCompleteness[]): number {
  return list.reduce((sum, c) => sum + c.omittedCount, 0);
}

/** Completeness for one category before per-category truncation is applied. */
function categorySourceCompleteness(
  cat: ContextDiffCategory,
  base: NormalizedRequestContext,
  target: NormalizedRequestContext,
): ContextCompleteness {
  const reasons = mergeReasons([base.completeness, target.completeness]);
  // item_limit can only affect the bounded item categories; system has no cap.
  const itemAffects = cat === 'messages' || cat === 'tools' || cat === 'parameters';
  const reasonsOut: ContextCompleteness['reasons'] = [];
  if (itemAffects && reasons.includes('item_limit')) reasonsOut.push('item_limit');
  return {
    complete: reasonsOut.length === 0,
    omittedCount: itemAffects && reasons.includes('item_limit') ? sumOmitted([base.completeness, target.completeness]) : 0,
    reasons: reasonsOut,
  };
}

// ── recursive changed-path reporting (tools, task 5.3) ──────────────────────

function diffJsonPaths(
  base: JsonValue,
  target: JsonValue,
  prefix: string,
  out: string[],
): void {
  if (canonicalSha256(base) === canonicalSha256(target)) return;
  if (isRecord(base) && isRecord(target)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(target)]);
    for (const k of keys) {
      const bp = base[k];
      const tp = target[k];
      const path = prefix === '' ? k : `${prefix}.${k}`;
      if (bp === undefined || tp === undefined) {
        out.push(path);
      } else if (isRecord(bp) && isRecord(tp)) {
        diffJsonPaths(bp as JsonValue, tp as JsonValue, path, out);
      } else if (Array.isArray(bp) && Array.isArray(tp)) {
        diffArrayPaths(bp, tp, path, out);
      } else if (canonicalSha256(bp as JsonValue) !== canonicalSha256(tp as JsonValue)) {
        out.push(path);
      }
    }
    return;
  }
  if (Array.isArray(base) && Array.isArray(target)) {
    diffArrayPaths(base, target, prefix, out);
    return;
  }
  out.push(prefix === '' ? 'value' : prefix);
}

function diffArrayPaths(base: JsonValue[], target: JsonValue[], prefix: string, out: string[]): void {
  const len = Math.max(base.length, target.length);
  for (let i = 0; i < len; i += 1) {
    const bp = base[i];
    const tp = target[i];
    const path = `${prefix}[${i}]`;
    if (bp === undefined || tp === undefined) {
      out.push(path);
    } else if (isRecord(bp) && isRecord(tp)) {
      diffJsonPaths(bp as JsonValue, tp as JsonValue, path, out);
    } else if (Array.isArray(bp) && Array.isArray(tp)) {
      diffArrayPaths(bp, tp, path, out);
    } else if (canonicalSha256(bp as JsonValue) !== canonicalSha256(tp as JsonValue)) {
      out.push(path);
    }
  }
}

// ── per-category alignment ───────────────────────────────────────────────────

interface CategoryOutcome {
  category: ContextDiffCategory;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  entries: ContextChangeEntry[];
}

function makeEntry(
  category: ContextDiffCategory,
  kind: ContextChangeKind,
  identity: string,
  label: string,
  beforePath: string | null,
  afterPath: string | null,
  beforeIndex: number | null,
  afterIndex: number | null,
  changedPaths: string[],
  before: ContextEvidenceValue | null,
  after: ContextEvidenceValue | null,
  segments: ContextDiffSegment[] | null,
  truncatedReason: 'inline_limit' | 'response_limit' | null,
): ContextChangeEntry {
  return {
    category,
    kind,
    identity,
    label,
    beforePath,
    afterPath,
    beforeIndex,
    afterIndex,
    changedPaths,
    before,
    after,
    segments,
    truncatedReason,
  };
}

/** System blocks: source-path identity first, then content hash. */
function diffSystem(base: NormalizedTextBlock[], target: NormalizedTextBlock[]): CategoryOutcome {
  const entries: ContextChangeEntry[] = [];
  let unchanged = 0;
  const matchedBase = new Set<number>();
  const matchedTarget = new Set<number>();

  // Pass 1: exact source-path identity.
  const baseByPath = new Map<string, number>();
  base.forEach((b, i) => baseByPath.set(b.sourcePath, i));
  target.forEach((t, j) => {
    const bi = baseByPath.get(t.sourcePath);
    if (bi !== undefined && !matchedBase.has(bi)) {
      matchedBase.add(bi);
      matchedTarget.add(j);
      const b = base[bi]!;
      if (b.text === t.text) {
        unchanged += 1;
      } else {
        const seg = textSegments(b.text, t.text);
        entries.push(
          makeEntry('system', 'modified', b.sourcePath, b.sourcePath,
            b.sourcePath, t.sourcePath, bi, j, ['text'],
            evidenceOf({ text: b.text }), evidenceOf({ text: t.text }),
            seg.segments, seg.truncatedReason),
        );
      }
    }
  });

  // Pass 2: remaining by equal text.
  const baseBag = new Map<string, number>();
  base.forEach((b, i) => {
    if (!matchedBase.has(i)) baseBag.set(b.text, (baseBag.get(b.text) ?? 0) + 1);
  });
  target.forEach((t, j) => {
    if (matchedTarget.has(j)) return;
    const count = baseBag.get(t.text) ?? 0;
    if (count > 0) {
      baseBag.set(t.text, count - 1);
      matchedTarget.add(j);
      unchanged += 1;
    }
  });

  // Remaining base -> removed, remaining target -> added.
  base.forEach((b, i) => {
    if (!matchedBase.has(i)) {
      entries.push(
        makeEntry('system', 'removed', b.sourcePath, b.sourcePath,
          b.sourcePath, null, i, null, [],
          evidenceOf({ text: b.text }), null, null, null),
      );
    }
  });
  target.forEach((t, j) => {
    if (!matchedTarget.has(j)) {
      entries.push(
        makeEntry('system', 'added', t.sourcePath, t.sourcePath,
          null, t.sourcePath, null, j, [],
          null, evidenceOf({ text: t.text }), null, null),
      );
    }
  });

  return summarize('system', entries, unchanged);
}

/** Tools: identity + occurrence, equal identity => unchanged or modified. */
function diffTools(base: NormalizedTool[], target: NormalizedTool[]): CategoryOutcome {
  const entries: ContextChangeEntry[] = [];
  let unchanged = 0;
  const toolKey = (t: NormalizedTool): string => `${t.identity}\u0000${t.occurrence}`;
  const baseMap = new Map<string, NormalizedTool>();
  base.forEach((t) => baseMap.set(toolKey(t), t));
  const matchedBase = new Set<string>();

  const toolValue = (t: NormalizedTool): JsonValue => ({
    name: t.name,
    type: t.type,
    description: t.description ?? null,
    schema: t.schema ?? null,
  });

  target.forEach((t, j) => {
    const key = toolKey(t);
    const b = baseMap.get(key);
    if (b === undefined) {
      entries.push(
        makeEntry('tools', 'added', `${t.identity}#${t.occurrence}`, t.name,
          null, t.sourcePath, null, j, [],
          null, evidenceOf(toolValue(t)), null, null),
      );
      return;
    }
    matchedBase.add(key);
    const bi = base.indexOf(b);
    const descEqual = (b.description ?? null) === (t.description ?? null);
    const schemaEqual = canonicalSha256(b.schema ?? null) === canonicalSha256(t.schema ?? null);
    if (descEqual && schemaEqual) {
      unchanged += 1;
      return;
    }
    const changedPaths: string[] = [];
    if (!descEqual) changedPaths.push('description');
    if (!schemaEqual) diffJsonPaths(b.schema ?? null, t.schema ?? null, 'schema', changedPaths);
    entries.push(
      makeEntry('tools', 'modified', `${t.identity}#${t.occurrence}`, t.name,
        b.sourcePath, t.sourcePath, bi, j, changedPaths,
        evidenceOf(toolValue(b)), evidenceOf(toolValue(t)), null, null),
    );
  });

  base.forEach((b, i) => {
    const key = toolKey(b);
    if (!matchedBase.has(key)) {
      entries.push(
        makeEntry('tools', 'removed', `${b.identity}#${b.occurrence}`, b.name,
          b.sourcePath, null, i, null, [],
          evidenceOf(toolValue(b)), null, null, null),
      );
    }
  });

  return summarize('tools', entries, unchanged);
}

/** Parameters: exact allowlisted key + typed canonical equality. */
function diffParameters(
  base: Record<string, JsonValue>,
  target: Record<string, JsonValue>,
): CategoryOutcome {
  const entries: ContextChangeEntry[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(target)]);
  const keyList = [...keys].sort();
  const baseIndex = new Map<string, number>(Object.keys(base).map((k, i) => [k, i]));
  const targetIndex = new Map<string, number>(Object.keys(target).map((k, i) => [k, i]));
  let unchanged = 0;

  for (const k of keyList) {
    const hasBase = Object.prototype.hasOwnProperty.call(base, k);
    const hasTarget = Object.prototype.hasOwnProperty.call(target, k);
    const b = base[k]!;
    const t = target[k]!;
    if (hasBase && hasTarget) {
      if (canonicalSha256(b) === canonicalSha256(t)) {
        unchanged += 1;
        continue;
      }
      const seg = textSegments(
        typeof b === 'string' ? b : '',
        typeof t === 'string' ? t : '',
      );
      entries.push(
        makeEntry('parameters', 'modified', k, k,
          null, null, baseIndex.get(k) ?? null, targetIndex.get(k) ?? null, [k],
          evidenceOf(b), evidenceOf(t),
          typeof b === 'string' && typeof t === 'string' ? seg.segments : null,
          typeof b === 'string' && typeof t === 'string' ? seg.truncatedReason : null),
      );
    } else if (hasBase) {
      entries.push(
        makeEntry('parameters', 'removed', k, k,
          null, null, baseIndex.get(k) ?? null, null, [k],
          evidenceOf(b), null, null, null),
      );
    } else {
      entries.push(
        makeEntry('parameters', 'added', k, k,
          null, null, null, targetIndex.get(k) ?? null, [k],
          null, evidenceOf(t), null, null),
      );
    }
  }

  return summarize('parameters', entries, unchanged);
}

/** Messages: stable ID -> canonical hash occurrence -> ordered gap. */
function diffMessages(base: NormalizedMessage[], target: NormalizedMessage[]): CategoryOutcome {
  const entries: ContextChangeEntry[] = [];
  let unchanged = 0;
  const matchedBase = new Set<number>();
  const matchedTarget = new Set<number>();
  const hashKey = (m: NormalizedMessage): string => `${m.role}\u0000${m.contentSha256}\u0000${m.occurrence}`;

  // Phase 1: explicit stable provider ID.
  const baseByStableId = new Map<string, number[]>();
  base.forEach((m, i) => {
    if (m.stableId !== null) {
      const arr = baseByStableId.get(m.stableId) ?? [];
      arr.push(i);
      baseByStableId.set(m.stableId, arr);
    }
  });
  target.forEach((m, j) => {
    if (m.stableId === null) return;
    const candidates = baseByStableId.get(m.stableId) ?? [];
    const bi = candidates.find((i) => !matchedBase.has(i));
    if (bi === undefined) return;
    matchedBase.add(bi);
    matchedTarget.add(j);
    const b = base[bi]!;
    if (canonicalSha256(b.content ?? null) === canonicalSha256(m.content ?? null)) {
      unchanged += 1;
    } else {
      entries.push(buildMessageEntry('modified', b, m, bi, j));
    }
  });

  // Phase 2: canonical hash + occurrence, order-preserving (monotonic base
  // index) so message order remains significant. Duplicate occurrences stay
  // independently matchable while a reordered message does not all match.
  const baseByHash = new Map<string, number[]>();
  base.forEach((m, i) => {
    if (matchedBase.has(i)) return;
    const k = hashKey(m);
    const arr = baseByHash.get(k) ?? [];
    arr.push(i);
    baseByHash.set(k, arr);
  });
  const hashPointers = new Map<string, number>();
  let lastMatchedBase = -1;
  target.forEach((m, j) => {
    if (matchedTarget.has(j)) return;
    const key = hashKey(m);
    const arr = baseByHash.get(key);
    if (arr === undefined) return;
    let ptr = hashPointers.get(key) ?? 0;
    while (ptr < arr.length && arr[ptr]! <= lastMatchedBase) ptr += 1;
    if (ptr >= arr.length) {
      hashPointers.set(key, ptr);
      return;
    }
    const bi = arr[ptr]!;
    hashPointers.set(key, ptr + 1);
    lastMatchedBase = bi;
    matchedBase.add(bi);
    matchedTarget.add(j);
    unchanged += 1;
  });

  // Phase 3: ordered unmatched-gap modification.
  const baseRemaining: { m: NormalizedMessage; i: number }[] = [];
  const targetRemaining: { m: NormalizedMessage; j: number }[] = [];
  base.forEach((m, i) => {
    if (!matchedBase.has(i)) baseRemaining.push({ m, i });
  });
  target.forEach((m, j) => {
    if (!matchedTarget.has(j)) targetRemaining.push({ m, j });
  });
  const gapLen = Math.min(baseRemaining.length, targetRemaining.length);
  for (let k = 0; k < gapLen; k += 1) {
    const b = baseRemaining[k]!;
    const t = targetRemaining[k]!;
    if (b.m.role === t.m.role && b.m.contentKind === t.m.contentKind) {
      if (canonicalSha256(b.m.content ?? null) === canonicalSha256(t.m.content ?? null)) {
        // Reordered equal message: report equivalent remove/add evidence so
        // order stays significant rather than being masked as unchanged.
        entries.push(buildMessageEntry('removed', b.m, null, b.i, null));
        entries.push(buildMessageEntry('added', null, t.m, null, t.j));
      } else {
        entries.push(buildMessageEntry('modified', b.m, t.m, b.i, t.j));
      }
      matchedBase.add(b.i);
      matchedTarget.add(t.j);
    }
  }

  baseRemaining.forEach(({ m, i }) => {
    if (!matchedBase.has(i)) entries.push(buildMessageEntry('removed', m, null, i, null));
  });
  targetRemaining.forEach(({ m, j }) => {
    if (!matchedTarget.has(j)) entries.push(buildMessageEntry('added', null, m, null, j));
  });

  return summarize('messages', entries, unchanged);
}

function buildMessageEntry(
  kind: ContextChangeKind,
  b: NormalizedMessage | null,
  t: NormalizedMessage | null,
  beforeIndex: number | null,
  afterIndex: number | null,
): ContextChangeEntry {
  const target = (t ?? b)!;
  const identity = target.stableId ?? `${target.role}\u0000${target.contentSha256}\u0000${target.occurrence}`;
  const label = target.stableId ?? `${target.role}·${target.contentKind}`;
  if (kind === 'added') {
    return makeEntry('messages', 'added', identity, label,
      null, target.sourcePath, null, afterIndex, [],
      null, evidenceOf(target.content ?? null), null, null);
  }
  if (kind === 'removed') {
    return makeEntry('messages', 'removed', identity, label,
      target.sourcePath, null, beforeIndex, null, [],
      evidenceOf(target.content ?? null), null, null, null);
  }
  const before = b!;
  const after = t!;
  const seg = textSegments(contentText(before.content ?? null), contentText(after.content ?? null));
  return makeEntry('messages', 'modified', identity, label,
    before.sourcePath, after.sourcePath, beforeIndex, afterIndex, ['content'],
    evidenceOf(before.content ?? null), evidenceOf(after.content ?? null),
    seg.segments, seg.truncatedReason);
}

function summarize(
  category: ContextDiffCategory,
  entries: ContextChangeEntry[],
  unchanged: number,
): CategoryOutcome {
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const e of entries) {
    if (e.kind === 'added') added += 1;
    else if (e.kind === 'removed') removed += 1;
    else modified += 1;
  }
  return { category, added, removed, modified, unchanged, entries };
}

// ── growth + indicators (task 5.7, D13) ──────────────────────────────────────

function buildGrowth(
  base: NormalizedRequestContext,
  target: NormalizedRequestContext,
  baseInputTokens: number | null,
  targetInputTokens: number | null,
): ContextGrowth {
  const baseChars = base.stats.totalChars;
  const targetChars = target.stats.totalChars;
  let inputTokenDelta: number | null = null;
  let inputTokenDeltaReason: ContextGrowth['inputTokenDeltaReason'] = 'usage_missing';
  if (baseInputTokens !== null && targetInputTokens !== null) {
    inputTokenDelta = targetInputTokens - baseInputTokens;
    inputTokenDeltaReason = 'captured_usage';
  }
  return {
    baseChars,
    targetChars,
    deltaChars: targetChars - baseChars,
    messageDelta: target.messages.length - base.messages.length,
    toolDelta: target.tools.length - base.tools.length,
    inputTokenDelta,
    inputTokenDeltaReason,
  };
}

function buildIndicators(
  base: NormalizedRequestContext,
  target: NormalizedRequestContext,
  global: ContextCompleteness,
  messagesRemoved: boolean,
  systemRemoved: boolean,
  toolsRemoved: boolean,
): ContextIndicator[] {
  const indicators: ContextIndicator[] = [];

  if (
    base.stats.messageChars > 0 &&
    target.stats.messageChars <= base.stats.messageChars * (1 - HISTORY_SHRINK_RATIO) &&
    messagesRemoved
  ) {
    indicators.push({
      code: 'history_shrink',
      classification: 'suspected_compaction',
      severity: 'warning',
      before: base.stats.messageChars,
      after: target.stats.messageChars,
      message: 'suspected context compaction: message history shrank by 30% or more',
    });
  }
  if (systemRemoved) {
    indicators.push({
      code: 'system_loss',
      classification: 'observation',
      severity: 'warning',
      before: base.system.length,
      after: target.system.length,
      message: 'one or more system instruction blocks were removed',
    });
  }
  if (toolsRemoved) {
    indicators.push({
      code: 'tool_loss',
      classification: 'observation',
      severity: 'warning',
      before: base.tools.length,
      after: target.tools.length,
      message: 'one or more tool definitions were removed',
    });
  }
  if (!global.complete) {
    indicators.push({
      code: 'source_incomplete',
      classification: 'observation',
      severity: 'info',
      before: null,
      after: null,
      message: 'evidence is incomplete or truncated; the result is not complete',
    });
  }
  return indicators;
}

// ── entry cap + response assembly (task 5.6) ─────────────────────────────────

const CATEGORY_ORDER: ContextDiffCategory[] = ['system', 'messages', 'tools', 'parameters'];

function applyEntryCap(
  outcomes: CategoryOutcome[],
  completeness: ContextCompleteness,
): { outcomes: CategoryOutcome[]; completeness: ContextCompleteness } {
  const all: { category: ContextDiffCategory; entry: ContextChangeEntry }[] = [];
  for (const o of outcomes) {
    for (const entry of o.entries) all.push({ category: o.category, entry });
  }
  let omitted = 0;
  if (all.length > MAX_CHANGE_ENTRIES) {
    omitted = all.length - MAX_CHANGE_ENTRIES;
    all.length = MAX_CHANGE_ENTRIES;
  }

  const byCat = new Map<ContextDiffCategory, ContextChangeEntry[]>();
  for (const { category, entry } of all) {
    const arr = byCat.get(category) ?? [];
    arr.push(entry);
    byCat.set(category, arr);
  }

  const capped = outcomes.map((o) => {
    const entries = byCat.get(o.category) ?? [];
    return summarize(o.category, entries, o.unchanged);
  });

  if (omitted > 0) {
    completeness = {
      complete: false,
      omittedCount: completeness.omittedCount + omitted,
      reasons: [...completeness.reasons, 'entry_limit'],
    };
  }
  return { outcomes: capped, completeness };
}

function hasInlineLimit(entry: ContextChangeEntry): boolean {
  return (
    entry.truncatedReason === 'inline_limit' ||
    entry.before?.truncated === true ||
    entry.after?.truncated === true
  );
}

export interface DiffContextsInput {
  base: NormalizedRequestContext;
  target: NormalizedRequestContext;
  baseInputTokens: number | null;
  targetInputTokens: number | null;
}

export interface ContextDiffResult {
  categories: ContextCategoryDiff[];
  growth: ContextGrowth;
  indicators: ContextIndicator[];
  completeness: ContextCompleteness;
  noChange: boolean;
}

/** One event-loop turn (design D12 staged flow). */
function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function diffContexts(input: DiffContextsInput): Promise<ContextDiffResult> {
  const { base, target } = input;
  const system = diffSystem(base.system, target.system);
  const parameters = diffParameters(base.parameters, target.parameters);
  await yieldTurn();
  const messages = diffMessages(base.messages, target.messages);
  const tools = diffTools(base.tools, target.tools);
  const outcomes = [system, messages, tools, parameters];

  const baseGlobal = categorySourceCompleteness('messages', base, target);
  const global: ContextCompleteness = {
    complete: baseGlobal.complete,
    omittedCount: baseGlobal.omittedCount,
    reasons: mergeReasons([base.completeness, target.completeness]),
  };
  const { outcomes: capped, completeness: globalCapped } = applyEntryCap(outcomes, global);

  const categories: ContextCategoryDiff[] = CATEGORY_ORDER.map((cat) => {
    const o = capped.find((c) => c.category === cat)!;
    const source = categorySourceCompleteness(cat, base, target);
    const reasons = [...source.reasons];
    let complete = source.complete;
    const omittedCount = source.omittedCount;
    if (o.entries.some(hasInlineLimit)) {
      complete = false;
      reasons.push('inline_limit');
    }
    return {
      category: cat,
      added: o.added,
      removed: o.removed,
      modified: o.modified,
      unchanged: o.unchanged,
      completeness: { complete, omittedCount, reasons },
      entries: o.entries,
    };
  });

  const totalChanges = categories.reduce(
    (sum, c) => sum + c.added + c.removed + c.modified,
    0,
  );
  const noChange = totalChanges === 0 && globalCapped.complete;

  const growth = buildGrowth(base, target, input.baseInputTokens, input.targetInputTokens);
  const indicators = buildIndicators(
    base,
    target,
    globalCapped,
    messages.removed > 0,
    system.removed > 0,
    tools.removed > 0,
  );

  return {
    categories,
    growth,
    indicators,
    completeness: globalCapped,
    noChange,
  };
}

// ── design D9: final response-size reduction (task 5.6) ──────────────────────

function setEntryResponseLimit(entry: ContextChangeEntry): void {
  entry.segments = null;
  entry.truncatedReason = 'response_limit';
}

/**
 * Serialize once and enforce the 1 MiB response budget. When over budget,
 * progressively remove inline equal segments, then shorten excerpts. If the
 * bounded representation still exceeds the limit, throw (never return an
 * oversized response). Marks completeness `response_limit` on truncation.
 */
export function enforceResponseBudget(
  response: RequestContextDiffResponse,
): RequestContextDiffResponse {
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') <= MAX_RESPONSE_BYTES) {
    return response;
  }

  // Pass 1: drop inline equal segments (keep added/removed evidence).
  for (const cat of response.categories) {
    for (const entry of cat.entries) {
      if (entry.segments !== null && entry.segments.length > 1) {
        entry.segments = entry.segments.filter((s) => s.kind !== 'equal');
        if (entry.segments.length === 0) entry.segments = null;
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') <= MAX_RESPONSE_BYTES) {
    return markResponseLimit(response);
  }

  // Pass 2: shorten excerpts to a fraction of the 4,096 bound.
  const shorten = (text: string): string => text.slice(0, Math.max(1, Math.floor(text.length / 4)));
  for (const cat of response.categories) {
    for (const entry of cat.entries) {
      if (entry.before?.truncated) {
        entry.before.excerptStart = shorten(entry.before.excerptStart);
        entry.before.excerptEnd = shorten(entry.before.excerptEnd);
      }
      if (entry.after?.truncated) {
        entry.after.excerptStart = shorten(entry.after.excerptStart);
        entry.after.excerptEnd = shorten(entry.after.excerptEnd);
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') <= MAX_RESPONSE_BYTES) {
    return markResponseLimit(response);
  }

  throw new Error('CONTEXT_DIFF_RESPONSE_OVERSIZED');
}

function markResponseLimit(response: RequestContextDiffResponse): RequestContextDiffResponse {
  for (const cat of response.categories) {
    for (const entry of cat.entries) {
      if (entry.segments !== null) setEntryResponseLimit(entry);
      cat.completeness = {
        complete: false,
        omittedCount: cat.completeness.omittedCount,
        reasons: [...cat.completeness.reasons, 'response_limit'],
      };
    }
  }
  response.completeness = {
    complete: false,
    omittedCount: response.completeness.omittedCount,
    reasons: [...response.completeness.reasons, 'response_limit'],
  };
  response.noChange = false;
  return response;
}
