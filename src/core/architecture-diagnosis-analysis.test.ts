import { describe, expect, it } from 'vitest';
import {
  analyzeArchitectureDiagnosis,
  DEFAULT_ARCHITECTURE_THRESHOLDS,
  validateArchitectureThresholds,
} from './architecture-diagnosis-analysis.js';
import type {
  ArchitectureContextSample,
  ArchitectureDiagnosisInput,
  ArchitectureHandoff,
  ArchitectureToolOutcome,
} from './architecture-diagnosis-types.js';

const TIME = '2026-10-29T03:00:00.000Z';
function fixture(): ArchitectureDiagnosisInput {
  return {
    version: 1, taskId: 'collected:task', title: 'Implement parser', member: 'all', origin: 'collected', revision: 'revision-1',
    evidence: [], contexts: [], outcomes: [], handoffs: [],
    coverage: { context: 'complete', tools: 'complete', handoffs: 'complete', nativeEvents: 0, nativeEventTotal: 0,
      captures: 0, logicalCalls: 0, omitted: 0, reasons: [] },
  };
}
function ref(input: ArchitectureDiagnosisInput, id: string): string {
  if (!input.evidence.some(source => source.id === id)) input.evidence.push({
    id, source: 'native_event', taskId: input.taskId, sessionKey: 'codex:session', eventId: id,
    captureId: null, callSequence: null, path: `$.events[${JSON.stringify(id)}]`, excerpt: `retained ${id}`,
  });
  return id;
}
function context(input: ArchitectureDiagnosisInput, id: string, overrides: Partial<ArchitectureContextSample> = {}): ArchitectureContextSample {
  const sample: ArchitectureContextSample = {
    id, refId: ref(input, id), streamId: 'native:agent', agentId: 'agent', order: input.contexts.length,
    contextTokens: null, tokenBasis: 'unavailable', contextChars: null, contextComplete: false,
    parts: [], tools: [], toolCatalogComplete: true, toolChoice: { mode: 'auto', name: null }, proposals: [], ...overrides,
  };
  input.contexts.push(sample); return sample;
}
function growth(input: ArchitectureDiagnosisInput, values = [12_000, 24_000, 40_000]): void {
  values.forEach((value, i) => context(input, `usage-${i}`, { contextTokens: value, tokenBasis: 'last_call_usage' }));
}
function outcome(input: ArchitectureDiagnosisInput, id: string, overrides: Partial<ArchitectureToolOutcome> = {}): ArchitectureToolOutcome {
  const result: ArchitectureToolOutcome = { id, agentId: 'agent', order: input.outcomes.length, name: 'search',
    callId: id, decisionKey: null, status: 'error', errorClass: 'unknown_tool', refId: ref(input, id), proposalRefId: null, ...overrides };
  input.outcomes.push(result); return result;
}
function handoff(input: ArchitectureDiagnosisInput, id: string, overrides: Partial<ArchitectureHandoff> = {}): ArchitectureHandoff {
  const result: ArchitectureHandoff = { id, senderAgentId: 'lead', recipientAgentId: 'worker',
    sentRefId: ref(input, `${id}:send`), receivedRefId: ref(input, `${id}:receive`), linkage: 'explicit',
    sentText: 'Read `/repo/src/parser.ts` and `parseToken`.', receivedText: 'Read `/repo/src/parser.ts` and `parseToken`.',
    sentComplete: true, receivedComplete: true, requiredFacts: [], ...overrides };
  input.handoffs.push(result); return result;
}
const analyze = (input: ArchitectureDiagnosisInput) => analyzeArchitectureDiagnosis(input, undefined, TIME);

describe('AD-002 public thresholds and source boundaries', () => {
  it('publishes complete defaults and returns independent validated copies', () => {
    expect(validateArchitectureThresholds()).toEqual(DEFAULT_ARCHITECTURE_THRESHOLDS);
    const changed = validateArchitectureThresholds({ minContextTokens: 64_000, growthRatio: 3 });
    expect(changed.minSamples).toBe(3); expect(changed.minContextTokens).toBe(64_000);
    changed.minSamples = 10;
    expect(DEFAULT_ARCHITECTURE_THRESHOLDS.minSamples).toBe(3);
  });
  it.each([
    { minSamples: 2 }, { minSamples: 3.5 }, { growthRatio: 1 }, { duplicateRatio: 0 },
    { toolCatalogLimit: 257 }, { repeatedToolErrors: 1 }, { minHandoffAnchors: 1 },
    { minContextTokens: Number.NaN }, { minContextChars: Number.POSITIVE_INFINITY },
  ])('rejects invalid thresholds %j', thresholds => {
    expect(() => validateArchitectureThresholds(thresholds)).toThrow();
  });
  it('rejects unknown, null and nonnumeric overrides', () => {
    expect(() => validateArchitectureThresholds({ unknown: 1 } as never)).toThrow('Unknown');
    expect(() => validateArchitectureThresholds(null as never)).toThrow();
    expect(() => validateArchitectureThresholds(new Date() as never)).toThrow('plain object');
    expect(() => validateArchitectureThresholds({ minSamples: '3' } as never)).toThrow();
  });
  it('does not invent context or tool facts from an empty source', () => {
    const report = analyze(fixture());
    expect(report.categories).toEqual({ context_bloat: 'insufficient', tool_conflict: 'insufficient', handoff_loss: 'not_observed' });
    expect(report.findings).toEqual([]); expect(report.evidence).toEqual([]);
    expect(report.analyzedAt).toBe(TIME);
  });
  it('requires exact valid source refs rather than trusting invented native locators', () => {
    const input = fixture(); growth(input); input.contexts[0]!.refId = 'driver-invented';
    expect(() => analyze(input)).toThrow('Unknown architecture evidence reference');
    input.contexts[0]!.refId = input.evidence[0]!.id; input.evidence[0]!.eventId = null;
    expect(() => analyze(input)).toThrow('Native architecture evidence');
  });
  it('rejects evidence belonging to another task and duplicate evidence IDs', () => {
    const input = fixture(); growth(input); input.evidence[0]!.taskId = 'another-task';
    expect(() => analyze(input)).toThrow('locator');
    input.evidence[0]!.taskId = input.taskId; input.evidence.push({ ...input.evidence[0]! });
    expect(() => analyze(input)).toThrow('locator');
  });
  it('keeps imported provenance and input immutable', () => {
    const input = fixture(); input.origin = 'imported'; growth(input);
    const before = structuredClone(input);
    expect(analyze(input).origin).toBe('imported'); expect(input).toEqual(before);
    expect(() => analyzeArchitectureDiagnosis(input, undefined, 'not a date')).toThrow('time');
  });
});

describe('AD-002 context growth and progressive disclosure', () => {
  it('locates three same-stream per-call measurements and gives a conditional split experiment', () => {
    const input = fixture(); growth(input);
    const report = analyze(input); const finding = report.findings.find(item => item.rule === 'context_growth')!;
    expect(report.categories.context_bloat).toBe('findings'); expect(finding.confidence).toBe('observed');
    expect(finding.evidenceIds).toEqual(['usage-0', 'usage-2']);
    expect(finding.metrics.find(item => item.key === 'growth_ratio')!.value).toBeCloseTo(40_000 / 12_000);
    expect(finding.metrics.find(item => item.key === 'carried_ratio')!.value).toBeNull();
    expect(finding.recommendation.action).toBe('split_candidate');
    expect(finding.recommendation.conditions.en).toContain('independent inputs');
    expect(finding.explanation.en).toContain('not irrelevance or quality degradation');
  });
  it('does not mix streams, token bases, duplicate source points or unknown usage', () => {
    for (const mode of ['streams', 'basis', 'duplicate', 'unknown'] as const) {
      const input = fixture(); growth(input);
      if (mode === 'streams') input.contexts.forEach((sample, index) => { sample.streamId = `agent-${index}`; });
      if (mode === 'basis') input.contexts[2]!.tokenBasis = 'request_usage';
      if (mode === 'duplicate') input.contexts[2]!.refId = input.contexts[0]!.refId;
      if (mode === 'unknown') input.contexts.forEach(sample => { sample.tokenBasis = 'unavailable'; });
      const report = analyze(input);
      expect(report.findings.some(item => item.rule === 'context_growth'), mode).toBe(false);
      expect(report.categories.context_bloat, mode).toBe('insufficient');
    }
  });
  it('does not use incremental request chars as full-context size, while explicit call usage remains usable', () => {
    const input = fixture();
    [16_000, 32_000, 64_000].forEach((chars, index) => context(input, `incremental-${index}`, { contextChars: chars }));
    expect(analyze(input).categories.context_bloat).toBe('insufficient');
    input.contexts.forEach((sample, index) => { sample.contextTokens = [16_000, 32_000, 64_000][index]!; sample.tokenBasis = 'request_usage'; });
    expect(analyze(input).findings.some(item => item.rule === 'context_growth')).toBe(true);
  });
  it('does not treat missing, invalid or fractional token counts as zero or measured context', () => {
    const input = fixture(); growth(input);
    input.contexts[0]!.contextTokens = null; input.contexts[1]!.contextTokens = Number.NaN; input.contexts[2]!.contextTokens = 40_000.5;
    const report = analyze(input); expect(report.findings).toEqual([]);
    expect(report.categories.context_bloat).toBe('insufficient');
    expect(report.coverage.nativeEventTotal).toBe(0);
    input.coverage.nativeEventTotal = null;
    expect(analyze(input).coverage.nativeEventTotal).toBeNull();
  });
  it('uses complete-context chars as a separate, explicitly labeled basis', () => {
    const input = fixture();
    [16_000, 32_000, 64_000].forEach((chars, index) => context(input, `chars-${index}`, { contextChars: chars, contextComplete: true }));
    const finding = analyze(input).findings.find(item => item.rule === 'context_growth')!;
    expect(finding.metrics.find(item => item.key === 'last_context')!.unit).toBe('chars');
    expect(finding.metrics.find(item => item.key === 'last_context')!.value).toBe(64_000);
  });
  it('does not turn a zero baseline or two points into a growth ratio', () => {
    for (const values of [[0, 20_000, 40_000], [12_000, 40_000]]) {
      const input = fixture(); growth(input, values);
      expect(analyze(input).findings.some(item => item.rule === 'context_growth')).toBe(false);
    }
  });
  it('respects public thresholds and marks a complete stable series not observed', () => {
    const input = fixture(); growth(input, [40_000, 42_000, 44_000]);
    expect(analyze(input).categories.context_bloat).toBe('not_observed');
    growth(input, [10_000, 20_000, 30_000]);
    const ordinary = fixture(); growth(ordinary);
    expect(analyzeArchitectureDiagnosis(ordinary, { minContextTokens: 60_000 }, TIME).findings).toEqual([]);
  });
  it('does not certify a whole task from partial or unavailable coverage', () => {
    for (const coverage of ['partial', 'unavailable'] as const) {
      const input = fixture(); growth(input, [40_000, 42_000, 44_000]); input.coverage.context = coverage;
      expect(analyze(input).categories.context_bloat).toBe('insufficient');
    }
  });
  it('measures repeated complete content but prioritizes progressive disclosure', () => {
    const input = fixture(); growth(input);
    input.contexts.forEach(sample => { sample.contextComplete = true; sample.parts = [
      { kind: 'message', hash: 'fixed-history', chars: 40_000, refId: sample.refId },
    ]; });
    const finding = analyze(input).findings.find(item => item.rule === 'context_growth')!;
    expect(finding.metrics.find(item => item.key === 'carried_ratio')!.value).toBe(1);
    expect(finding.recommendation.action).toBe('progressive_disclosure');
  });
  it('identifies redundant copies inside one complete request, not just long messages', () => {
    const input = fixture(); const sample = context(input, 'duplicates', { contextComplete: true, contextChars: 40_000 });
    sample.parts = Array.from({ length: 4 }, () => ({ kind: 'tool' as const, hash: 'same-tool-result', chars: 10_000, refId: sample.refId }));
    const finding = analyze(input).findings.find(item => item.rule === 'duplicate_context_parts')!;
    expect(finding.metrics.find(item => item.key === 'duplicate_chars')!.value).toBe(30_000);
    expect(finding.recommendation.action).toBe('progressive_disclosure');
    sample.contextComplete = false;
    expect(analyze(input).findings).toEqual([]);
  });
  it('finds a large catalog without calling frequency or count a tool conflict', () => {
    const input = fixture(); const sample = context(input, 'catalog');
    sample.tools = Array.from({ length: 40 }, (_, index) => ({ name: `tool-${index}`, signature: `schema-${index}`, requiredArguments: [], refId: sample.refId }));
    const report = analyze(input);
    expect(report.findings.map(item => item.rule)).toEqual(['large_tool_catalog']);
    expect(report.findings[0]!.recommendation.action).toBe('progressive_disclosure');
    expect(report.categories.tool_conflict).toBe('not_observed');
    sample.toolCatalogComplete = false;
    expect(analyze(input).findings).toEqual([]);
  });
});

describe('AD-002 tool declarations, proposals and explicit outcomes', () => {
  it('distinguishes conflicting schemas from a duplicate identical declaration', () => {
    const input = fixture(); const sample = context(input, 'tools');
    sample.tools = [{ name: 'search', signature: 'v1', requiredArguments: ['query'], refId: ref(input, 'schema-1') },
      { name: 'search', signature: 'v2', requiredArguments: ['pattern'], refId: ref(input, 'schema-2') }];
    const finding = analyze(input).findings[0]!;
    expect(finding.rule).toBe('same_name_different_schema'); expect(finding.evidenceIds).toEqual(['schema-1', 'schema-2']);
    expect(finding.recommendation.action).toBe('repair_tool_contract');
    sample.tools[1]!.signature = 'v1';
    expect(analyze(input).findings).toEqual([]);
    sample.tools[1]!.signature = 'v2'; sample.toolCatalogComplete = false;
    expect(analyze(input).findings).toEqual([]);
  });
  it('checks actual undeclared proposals only with a known complete callable catalog', () => {
    const input = fixture(); const sample = context(input, 'request');
    sample.proposals = [{ id: 'proposal', name: 'builtin_search', argumentKeys: [], argumentsComplete: true, refId: ref(input, 'proposal') }];
    const finding = analyze(input).findings[0]!;
    expect(finding.rule).toBe('undeclared_tool_proposal'); expect(finding.explanation.en).toContain('not an execution result');
    expect(finding.metrics.find(item => item.key === 'missing_arguments')!.value).toBeNull();
    sample.toolCatalogComplete = false;
    expect(analyze(input).findings).toEqual([]); expect(analyze(input).categories.tool_conflict).toBe('insufficient');
  });
  it.each([{ mode: 'none', name: null }, { mode: 'named', name: 'write' }] as const)('checks explicit forced choice %j', choice => {
    const input = fixture(); const sample = context(input, 'request', { toolChoice: choice });
    sample.tools = [{ name: 'read', signature: 'read-schema', requiredArguments: [], refId: sample.refId }];
    sample.proposals = [{ id: 'read-proposal', name: 'read', argumentKeys: [], argumentsComplete: true, refId: ref(input, 'read-proposal') }];
    expect(analyze(input).findings[0]!.rule).toBe('forced_tool_choice_mismatch');
    sample.toolChoice = { mode: 'auto', name: null };
    expect(analyze(input).findings).toEqual([]);
  });
  it('requires complete arguments and an unambiguous schema before claiming a missing key', () => {
    const input = fixture(); const sample = context(input, 'request');
    sample.tools = [{ name: 'read', signature: 'read-schema', requiredArguments: ['path'], refId: sample.refId }];
    sample.proposals = [{ id: 'read-proposal', name: 'read', argumentKeys: [], argumentsComplete: true, refId: ref(input, 'read-proposal') }];
    expect(analyze(input).findings[0]!.rule).toBe('missing_required_arguments');
    sample.proposals[0]!.argumentsComplete = false;
    expect(analyze(input).findings).toEqual([]);
    sample.proposals[0]!.argumentsComplete = true; sample.proposals[0]!.argumentKeys = ['path'];
    expect(analyze(input).findings).toEqual([]);
  });
  it('separately records actual unknown-tool and invalid-argument errors with deduplication', () => {
    const input = fixture(); outcome(input, 'result-1', { callId: 'call-1' });
    outcome(input, 'same-execution', { callId: 'call-1' }); outcome(input, 'result-2', { callId: 'call-2' });
    const report = analyze(input); const finding = report.findings.find(item => item.rule === 'repeated_explicit_tool_errors')!;
    expect(finding.metrics[0]!.value).toBe(2); expect(finding.evidenceIds).toEqual(['result-1', 'result-2']);
    expect(finding.recommendation.action).toBe('repair_tool_contract');
    outcome(input, 'args', { errorClass: 'invalid_arguments' });
    expect(analyze(input).findings.some(item => item.rule === 'explicit_tool_error')).toBe(true);
  });
  it('does not accumulate repeated errors across unknown agent ownership, sources or different decisions', () => {
    const input = fixture(); outcome(input, 'native', { agentId: null }); outcome(input, 'capture', { agentId: null });
    expect(analyze(input).findings.every(item => item.rule === 'explicit_tool_error')).toBe(true);
    expect(analyze(input).findings.every(item => item.metrics[0]!.value === 1)).toBe(true);
    input.outcomes.forEach(result => { result.agentId = 'same-agent'; result.callId = null; result.decisionKey = 'same-decision'; });
    expect(analyze(input).findings[0]!.metrics[0]!.value).toBe(1);
  });
  it('never infers conflicts from permission, generic failures, success or varied tool names', () => {
    const input = fixture(); context(input, 'catalog');
    outcome(input, 'permission', { errorClass: 'permission' }); outcome(input, 'generic', { errorClass: 'other' });
    outcome(input, 'ok', { name: 'read', status: 'ok', errorClass: null });
    outcome(input, 'also-ok', { name: 'write', status: 'ok', errorClass: null });
    expect(analyze(input).findings).toEqual([]);
    expect(analyze(input).categories.tool_conflict).toBe('not_observed');
  });
});

describe('AD-002 explicit handoffs and conservative reference gaps', () => {
  it('links exact sender and receiver evidence but labels semantic loss only heuristic', () => {
    const input = fixture(); const message = handoff(input, 'send-1', { receivedText: 'Implement the parser.' });
    message.requiredFacts = [{ key: 'file', value: '/repo/src/parser.ts', refId: message.sentRefId }];
    const finding = analyze(input).findings[0]!;
    expect(finding.rule).toBe('handoff_required_reference_gap'); expect(finding.confidence).toBe('heuristic');
    expect(finding.evidenceIds).toEqual(['send-1:send', 'send-1:receive']);
    expect(finding.metrics.find(item => item.key === 'missing_literal_anchors')!.value).toBe(1);
    expect(finding.explanation.en).toContain('semantic loss is not established');
    expect(finding.recommendation.action).toBe('verify_first');
  });
  it('checks conservative URL, path and backtick anchors from complete actual messages', () => {
    const input = fixture(); handoff(input, 'send', {
      sentText: 'Use https://example.test/spec. Read /repo/src/parser.ts and `parseToken`.',
      receivedText: 'Use https://example.test/spec. Read /repo/src/parser.ts.',
    });
    const finding = analyze(input).findings[0]!;
    expect(finding.rule).toBe('handoff_literal_anchor_gap');
    expect(finding.metrics.find(item => item.key === 'anchors')!.value).toBe(3);
    expect(finding.metrics.find(item => item.key === 'missing_literal_anchors')!.value).toBe(1);
  });
  it.each(['recipient', 'receive-ref', 'unresolved', 'ambiguous', 'truncated-send', 'truncated-receive', 'self'] as const)('requires explicit complete paired communication: %s', kind => {
    const input = fixture(); const message = handoff(input, 'send', { receivedText: 'short response' });
    if (kind === 'recipient') message.recipientAgentId = null;
    if (kind === 'receive-ref') message.receivedRefId = null;
    if (kind === 'unresolved') message.linkage = 'unresolved';
    if (kind === 'ambiguous') message.linkage = 'ambiguous';
    if (kind === 'truncated-send') message.sentComplete = false;
    if (kind === 'truncated-receive') message.receivedComplete = false;
    if (kind === 'self') message.recipientAgentId = message.senderAgentId;
    const report = analyze(input); expect(report.findings).toEqual([]);
    expect(report.categories.handoff_loss).toBe('insufficient');
  });
  it('does not call a shorter paraphrase or ordinary constraint sentence a proven loss', () => {
    const input = fixture(); handoff(input, 'summary', {
      sentText: 'Please inspect the parser carefully and do not modify tests. Explain any issue you find.',
      receivedText: 'Review parser; keep tests unchanged; report issues.',
    });
    const report = analyze(input); expect(report.findings).toEqual([]);
    expect(report.categories.handoff_loss).toBe('insufficient');
  });
  it('accepts preserved literal references with additional context and avoids general semantic claims', () => {
    const input = fixture(); handoff(input, 'send', { receivedText: 'Inherited context. Read /repo/src/parser.ts; implement parseToken. Keep tests unchanged.' });
    const report = analyze(input); expect(report.findings).toEqual([]);
    expect(report.categories.handoff_loss).toBe('not_observed');
    input.coverage.handoffs = 'partial';
    expect(analyze(input).categories.handoff_loss).toBe('insufficient');
  });
  it('suggests merging only conditionally after multiple real paired gaps, never from tool reuse', () => {
    const input = fixture(); handoff(input, 'first', { receivedText: 'Implement parser.' });
    handoff(input, 'second', { senderAgentId: 'worker', recipientAgentId: 'lead', receivedText: 'Parser ready.' });
    const finding = analyze(input).findings.find(item => item.rule === 'repeated_handoff_reference_gaps')!;
    expect(finding.recommendation.action).toBe('merge_candidate');
    expect(finding.recommendation.conditions.en).toContain('depend on each other sequentially');
    expect(finding.recommendation.conditions.en).toContain('not decide from tool reuse alone');
    const duplicate = fixture(); const first = handoff(duplicate, 'first', { receivedText: 'Implement parser.' });
    duplicate.handoffs.push({ ...first, id: 'duplicate-record' });
    expect(analyze(duplicate).findings.some(item => item.rule === 'repeated_handoff_reference_gaps')).toBe(false);
  });
  it('can review multiple actual spawn boundaries from one lead without inventing repeated peer messages', () => {
    const input = fixture(); handoff(input, 'spawn-a', { recipientAgentId: 'worker-a', receivedText: 'Implement parser.' });
    handoff(input, 'spawn-b', { recipientAgentId: 'worker-b', receivedText: 'Check parser.' });
    const finding = analyze(input).findings.find(item => item.rule === 'repeated_delegation_reference_gaps')!;
    expect(finding.recommendation.action).toBe('merge_candidate'); expect(finding.confidence).toBe('heuristic');
    expect(finding.evidenceIds).toEqual(['spawn-a:send', 'spawn-a:receive', 'spawn-b:send', 'spawn-b:receive']);
    expect(finding.explanation.en).toContain('not proof of tight coupling');
    input.handoffs[1]!.receivedText = input.handoffs[1]!.sentText;
    expect(analyze(input).findings.some(item => item.rule === 'repeated_delegation_reference_gaps')).toBe(false);
    input.handoffs[1]!.receivedText = 'Check parser.'; input.handoffs[1]!.linkage = 'unresolved';
    expect(analyze(input).findings.some(item => item.rule === 'repeated_delegation_reference_gaps')).toBe(false);
  });
});

describe('AD-002 bounded bilingual report', () => {
  it('retains partial-sample findings without certifying unseen task data', () => {
    const input = fixture(); growth(input); input.coverage.context = 'partial'; input.coverage.omitted = 5;
    const report = analyze(input); expect(report.categories.context_bloat).toBe('findings');
    expect(report.coverage.omitted).toBe(5); expect(report.limitations.some(item => item.en.includes('whole task'))).toBe(true);
    for (const finding of report.findings) {
      expect(finding.title.zh).toBeTruthy(); expect(finding.title.en).toBeTruthy();
      expect(finding.recommendation.verification.zh).toBeTruthy(); expect(finding.recommendation.verification.en).toBeTruthy();
      expect(finding.evidenceIds.every(id => report.evidence.some(source => source.id === id))).toBe(true);
    }
  });
  it('caps findings and refs, includes all categories and discloses omissions', () => {
    const input = fixture(); growth(input);
    for (let index = 0; index < 90; index += 1) outcome(input, `error-${index}`, { agentId: null });
    handoff(input, 'handoff', { receivedText: 'Do work' });
    const report = analyze(input);
    expect(report.findings).toHaveLength(64); expect(report.findings.every(finding => finding.evidenceIds.length <= 8)).toBe(true);
    expect(new Set(report.findings.map(item => item.category)).size).toBe(3);
    expect(report.coverage.omitted).toBe(28); expect(report.limitations.some(item => item.en.includes('omitted 28'))).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(report)).byteLength).toBeLessThanOrEqual(512 * 1024);
  });
  it('enforces the byte budget without silently clipping exact source paths', () => {
    const input = fixture();
    for (let index = 0; index < 64; index += 1) {
      const result = outcome(input, `error-${index}`, { agentId: null });
      input.evidence.find(source => source.id === result.refId)!.path = `$.${'证'.repeat(8000)}`;
    }
    const report = analyze(input);
    expect(report.findings.length).toBeLessThan(64); expect(report.coverage.omitted).toBeGreaterThan(0);
    expect(new TextEncoder().encode(JSON.stringify(report)).byteLength).toBeLessThanOrEqual(512 * 1024);
    expect(report.evidence.every(source => source.path.length === 8002)).toBe(true);
    expect(report.categories.tool_conflict).toBe('findings');
  });
  it('explicitly discloses reference truncation within a supported repeated-error finding', () => {
    const input = fixture();
    for (let index = 0; index < 12; index += 1) outcome(input, `error-${index}`);
    const report = analyze(input); const finding = report.findings[0]!;
    expect(finding.metrics[0]!.value).toBe(12); expect(finding.evidenceIds).toHaveLength(8);
    expect(finding.explanation.en).toContain('12 source locations; only the first 8');
    expect(report.evidence).toHaveLength(8);
  });
});
