import type {
  ArchitectureCategory,
  ArchitectureContextSample,
  ArchitectureDiagnosisInput,
  ArchitectureDiagnosisReport,
  ArchitectureEvidence,
  ArchitectureFinding,
  ArchitectureHandoff,
  ArchitectureText,
  ArchitectureThresholds,
} from './architecture-diagnosis-types.js';

/** Product heuristics, exposed for inspection and controlled experiments. */
export const DEFAULT_ARCHITECTURE_THRESHOLDS: Readonly<ArchitectureThresholds> = Object.freeze({
  minSamples: 3,
  minContextTokens: 32_000,
  minContextChars: 32_768,
  growthRatio: 2,
  duplicateRatio: 0.6,
  toolCatalogLimit: 32,
  repeatedToolErrors: 2,
  minHandoffAnchors: 2,
});

const LIMITS = { findings: 64, refs: 8, bytes: 512 * 1024 } as const;
const CATEGORIES: ArchitectureCategory[] = ['context_bloat', 'tool_conflict', 'handoff_loss'];
const text = (zh: string, en: string): ArchitectureText => ({ zh, en });
type Metric = ArchitectureFinding['metrics'][number];
const metric = (key: string, zh: string, en: string, value: number | null, unit: string): Metric =>
  ({ key, label: text(zh, en), value, unit });
const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** Reject malformed overrides rather than silently changing the requested experiment. */
export function validateArchitectureThresholds(value?: Partial<ArchitectureThresholds>): ArchitectureThresholds {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError('Architecture thresholds must be an object');
  }
  if (value !== undefined && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Architecture thresholds must be a plain object');
  }
  const bounds: Record<keyof ArchitectureThresholds, [number, number, boolean]> = {
    minSamples: [3, 100, true],
    minContextTokens: [1, 10_000_000, true],
    minContextChars: [1, 16_777_216, true],
    growthRatio: [1.1, 100, false],
    duplicateRatio: [0.1, 1, false],
    toolCatalogLimit: [1, 256, true],
    repeatedToolErrors: [2, 32, true],
    minHandoffAnchors: [2, 32, true],
  };
  const result = { ...DEFAULT_ARCHITECTURE_THRESHOLDS };
  for (const [key, number] of Object.entries(value ?? {})) {
    if (!Object.hasOwn(bounds, key)) throw new TypeError(`Unknown architecture threshold: ${key}`);
    const field = key as keyof ArchitectureThresholds;
    const [min, max, integer] = bounds[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max
      || (integer && !Number.isInteger(number))) {
      throw new RangeError(`Invalid architecture threshold: ${key}`);
    }
    result[field] = number;
  }
  return result;
}

const intervention = (
  action: ArchitectureFinding['recommendation']['action'],
  reason: ArchitectureText,
): ArchitectureFinding['recommendation'] => ({
  action,
  reason,
  conditions: action === 'split_candidate'
    ? text('仅当这段工作有独立输入、清晰交付物，且完成后可丢弃其历史；先确认主循环不依赖中间推理。',
      'Only split work with independent inputs, a clear deliverable, and disposable history; first confirm the main loop does not depend on intermediate reasoning.')
    : action === 'merge_candidate'
      ? text('仅当这些步骤需要频繁共享细节、严格按顺序互相依赖；保留独立结果校验，不能仅凭工具相同决定合并。',
        'Only merge steps that frequently share detailed state and depend on each other sequentially; retain independent verification and do not decide from tool reuse alone.')
      : action === 'progressive_disclosure'
        ? text('先识别当前步骤真正需要的工具、技能和历史；完整信息仍需可按需取回，不能删除必要约束。',
          'Identify tools, skills, and history needed by the current step; keep full information retrievable on demand and preserve required constraints.')
        : action === 'repair_tool_contract'
          ? text('先核对实际可调用名称、唯一 Schema、tool choice 和必填参数；不要把声明或提议当成已经执行。',
            'First reconcile callable names, unique schemas, tool choice, and required arguments; declarations and proposals are not executions.')
          : text('先补齐同一范围的真实输入、接收记录与来源证据；证据不足时不改架构。',
            'First obtain real inputs, received records, and source evidence for the same scope; do not change architecture on insufficient evidence.'),
  verification: text('固定任务、模型、工具和成功标准，保存改动前后逐轮 telemetry；比较输入规模、重试、交接和中间步骤，再检验结果质量。',
    'Hold task, model, tools, and success criteria fixed. Retain before/after per-turn telemetry, compare input size, retries, handoffs, and intermediate steps, then verify result quality.'),
});

function validateInput(input: ArchitectureDiagnosisInput): Map<string, ArchitectureEvidence> {
  if (input.version !== 1 || !input.taskId || !input.revision) throw new TypeError('Invalid architecture diagnosis input');
  if (input.evidence.length > 512 || input.contexts.length > 400 || input.handoffs.length > 32 || input.outcomes.length > 8192) {
    throw new RangeError('Architecture diagnosis input budget exceeded');
  }
  for (const value of [input.taskId, input.member, input.revision]) {
    if (value.length > 4096) throw new RangeError('Architecture diagnosis identifier budget exceeded');
  }
  if (input.title.length > 8192 || input.coverage.reasons.length > 128
    || input.coverage.reasons.some(reason => reason.length > 2048)) {
    throw new RangeError('Architecture diagnosis metadata budget exceeded');
  }
  if (new TextEncoder().encode(JSON.stringify({
    taskId: input.taskId, title: input.title, member: input.member, revision: input.revision, coverage: input.coverage,
  })).byteLength > 64 * 1024) throw new RangeError('Architecture diagnosis metadata byte budget exceeded');
  const refs = new Map<string, ArchitectureEvidence>();
  for (const ref of input.evidence) {
    if (!ref.id || refs.has(ref.id) || ref.taskId !== input.taskId || !ref.path
      || ref.id.length > 4096 || ref.path.length > 8192
      || (ref.sessionKey?.length ?? 0) > 4096 || (ref.eventId?.length ?? 0) > 4096) {
      throw new TypeError('Invalid architecture evidence locator');
    }
    if (ref.source === 'native_event' && (!ref.sessionKey || !ref.eventId)) {
      throw new TypeError('Native architecture evidence requires a session and event');
    }
    if (ref.source !== 'native_event' && (!Number.isSafeInteger(ref.captureId) || (ref.captureId ?? 0) < 1)) {
      throw new TypeError('Capture architecture evidence requires a capture');
    }
    if (ref.source === 'codex_call' && (!Number.isSafeInteger(ref.callSequence) || (ref.callSequence ?? -1) < 0)) {
      throw new TypeError('Codex architecture evidence requires a logical call');
    }
    refs.set(ref.id, ref);
  }
  const requireRef = (id: string | null) => {
    if (id !== null && !refs.has(id)) throw new TypeError(`Unknown architecture evidence reference: ${id.slice(0, 80)}`);
  };
  for (const sample of input.contexts) {
    if (sample.parts.length > 128 || sample.tools.length > 256 || sample.proposals.length > 128) {
      throw new RangeError('Architecture sample budget exceeded');
    }
    requireRef(sample.refId);
    sample.parts.forEach(part => requireRef(part.refId));
    sample.tools.forEach(tool => requireRef(tool.refId));
    sample.proposals.forEach(proposal => requireRef(proposal.refId));
  }
  input.outcomes.forEach(outcome => { requireRef(outcome.refId); requireRef(outcome.proposalRefId); });
  input.handoffs.forEach(handoff => {
    requireRef(handoff.sentRefId); requireRef(handoff.receivedRefId);
    handoff.requiredFacts.forEach(fact => requireRef(fact.refId));
  });
  return refs;
}

const knownNumber = (value: number | null): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const normalize = (value: string): string => value.replace(/\s+/gu, ' ').trim();

/** Only conservative literal references: ordinary prose may be faithfully paraphrased. */
function anchors(value: string): string[] {
  const found = [
    ...value.matchAll(/https?:\/\/[^\s<>"'`]+/gu),
    ...value.matchAll(/`[^`\n]{2,240}`/gu),
    ...value.matchAll(/(?:^|[\s("'])((?:\/[A-Za-z0-9_~.@-]+){2,}(?:\.[A-Za-z0-9]+)?|\.\.?\/[A-Za-z0-9_~.@/-]+)/gmu),
  ];
  return unique(found.map(match => (match[1] ?? match[0]).replace(/[.,;:!?，。；：！？)\]]+$/gu, '').replace(/^`|`$/gu, ''))
    .filter(anchor => anchor.length >= 2)).slice(0, 32);
}

export function analyzeArchitectureDiagnosis(
  input: ArchitectureDiagnosisInput,
  thresholdOverrides?: Partial<ArchitectureThresholds>,
  analyzedAt = new Date().toISOString(),
): ArchitectureDiagnosisReport {
  const thresholds = validateArchitectureThresholds(thresholdOverrides);
  const refs = validateInput(input);
  if (!Number.isFinite(Date.parse(analyzedAt))) throw new TypeError('Invalid architecture analysis time');
  const findings: ArchitectureFinding[] = [];
  const limitations: ArchitectureText[] = [text(
    '阈值是可调整的产品启发式规则。上下文增长不证明质量下降；字面引用缺失不证明语义丢失。建议需通过固定任务实验验证。',
    'Thresholds are adjustable product heuristics. Context growth does not prove quality degradation, and missing literal references do not prove semantic loss. Validate recommendations with fixed-task experiments.',
  )];
  const uncertain = { context_bloat: false, tool_conflict: false, handoff_loss: false };
  const detected = { context_bloat: 0, tool_conflict: 0, handoff_loss: 0 };
  let candidateOmitted = 0;
  let serial = 0;
  const add = (finding: Omit<ArchitectureFinding, 'id'>) => {
    const allRefs = unique(finding.evidenceIds);
    const evidenceIds = allRefs.slice(0, LIMITS.refs);
    if (evidenceIds.length === 0) return;
    serial += 1;
    detected[finding.category] += 1;
    if (detected[finding.category] > LIMITS.findings) { candidateOmitted += 1; return; }
    const explanation = allRefs.length > LIMITS.refs ? text(
      `${finding.explanation.zh} 本项共引用 ${allRefs.length} 处来源，仅展示前 ${LIMITS.refs} 处。`,
      `${finding.explanation.en} This finding cites ${allRefs.length} source locations; only the first ${LIMITS.refs} are displayed.`,
    ) : finding.explanation;
    findings.push({ ...finding, explanation, id: `architecture:${finding.category}:${serial}`, evidenceIds });
  };

  // Compare only one source stream and one measured input basis at a time.
  const streams = new Map<string, ArchitectureContextSample[]>();
  for (const sample of input.contexts) {
    const list = streams.get(sample.streamId) ?? [];
    if (!list.some(other => other.id === sample.id || other.refId === sample.refId)) list.push(sample);
    streams.set(sample.streamId, list);
    if (!(sample.tokenBasis !== 'unavailable' && knownNumber(sample.contextTokens))
      && !(sample.contextComplete && knownNumber(sample.contextChars))) uncertain.context_bloat = true;
  }
  let comparableStreams = 0;
  for (const samples of streams.values()) {
    samples.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const tokenGroups = ['request_usage', 'last_call_usage'].map(basis => ({
      basis, unit: 'tokens', samples: samples.filter(sample => sample.tokenBasis === basis && knownNumber(sample.contextTokens)),
      value: (sample: ArchitectureContextSample) => sample.contextTokens,
    }));
    const charGroup = {
      basis: 'complete_context_chars', unit: 'chars',
      samples: samples.filter(sample => sample.contextComplete && knownNumber(sample.contextChars)),
      value: (sample: ArchitectureContextSample) => sample.contextChars,
    };
    const comparable = [...tokenGroups, charGroup].filter(group => group.samples.length >= thresholds.minSamples);
    if (comparable.length === 0) { uncertain.context_bloat = true; continue; }
    comparableStreams += 1;
    // Prefer measured per-call usage; never add tokens and characters or duplicate native/capture observations.
    const group = comparable[0]!;
    const first = group.samples[0]!;
    const last = group.samples[group.samples.length - 1]!;
    const start = group.value(first)!;
    const end = group.value(last)!;
    const ratio = start > 0 ? end / start : null;
    if (start === 0 && end > 0) uncertain.context_bloat = true;
    const minimum = group.unit === 'tokens' ? thresholds.minContextTokens : thresholds.minContextChars;
    if (ratio !== null && ratio >= thresholds.growthRatio && end >= minimum) {
      const earlierHashes = new Set(group.samples.slice(0, -1).flatMap(sample => sample.parts.filter(part => part.hash).map(part => `${part.kind}:${part.hash}`)));
      const parts = last.parts.filter(part => part.hash && knownNumber(part.chars));
      const total = parts.reduce((sum, part) => sum + part.chars, 0);
      const carried = parts.filter(part => earlierHashes.has(`${part.kind}:${part.hash}`)).reduce((sum, part) => sum + part.chars, 0);
      const repeatRatio = total > 0 ? carried / total : null;
      const catalog = last.toolCatalogComplete && last.tools.length >= thresholds.toolCatalogLimit;
      const repeated = last.contextComplete && repeatRatio !== null && repeatRatio >= thresholds.duplicateRatio;
      const action = catalog || repeated ? 'progressive_disclosure' : 'split_candidate';
      add({
        category: 'context_bloat', rule: 'context_growth', severity: 'warning', confidence: 'observed',
        title: text('同一上下文流显著增长', 'Substantial growth within one context stream'),
        explanation: text(
          `在 ${group.samples.length} 个同流、同口径样本中，输入从 ${start} 增至 ${end} ${group.unit}（${ratio.toFixed(2)} 倍）。相同哈希仅说明内容再次携带，不说明它无用或已损害质量。`,
          `Across ${group.samples.length} samples from one stream and basis, input grew from ${start} to ${end} ${group.unit} (${ratio.toFixed(2)}×). Identical hashes show carried content, not irrelevance or quality degradation.`,
        ),
        evidenceIds: [first.refId, last.refId, ...last.parts.filter(part => earlierHashes.has(`${part.kind}:${part.hash}`)).map(part => part.refId)],
        metrics: [metric('samples', '同口径样本', 'Comparable samples', group.samples.length, 'samples'),
          metric('first_context', '首个输入规模', 'First input size', start, group.unit),
          metric('last_context', '最后输入规模', 'Last input size', end, group.unit),
          metric('growth_ratio', '增长倍数', 'Growth ratio', ratio, 'ratio'),
          metric('carried_ratio', '可见分块重复携带比例', 'Repeated share of visible parts', last.contextComplete ? repeatRatio : null, 'ratio')],
        recommendation: intervention(action, catalog || repeated
          ? text('先按需加载工具与历史，保留原文检索；重复携带本身不足以证明应拆分。',
            'First load tools and history on demand while preserving access to originals; carried content alone does not justify splitting.')
          : text('检查增长是否主要来自可独立完成的调查或工具输出；可试把该分支交给子 Agent 并只回传约定交付物。',
            'Check whether growth comes from an independent investigation or tool-output branch; try a subagent that returns only the agreed deliverable.')),
      });
    }
  }
  if (comparableStreams === 0) uncertain.context_bloat = true;

  const duplicateSamples = input.contexts.flatMap(sample => {
    if (!sample.contextComplete) return [];
    const seen = new Set<string>();
    let total = 0; let duplicated = 0;
    const duplicatedRefs: string[] = [];
    for (const part of sample.parts) {
      if (!knownNumber(part.chars) || !part.hash) continue;
      total += part.chars;
      const key = `${part.kind}:${part.hash}`;
      if (seen.has(key)) { duplicated += part.chars; duplicatedRefs.push(part.refId); }
      seen.add(key);
    }
    return total >= thresholds.minContextChars && total > 0 && duplicated / total >= thresholds.duplicateRatio
      ? [{ sample, total, duplicated, duplicatedRefs }] : [];
  });
  if (duplicateSamples.length > 0) {
    const largest = duplicateSamples.reduce((left, right) => right.duplicated > left.duplicated ? right : left);
    add({ category: 'context_bloat', rule: 'duplicate_context_parts', severity: 'warning', confidence: 'observed',
      title: text('单次完整上下文含重复分块', 'One complete context contains duplicate parts'),
      explanation: text(`可见完整分块共 ${largest.total} 字符，其中 ${largest.duplicated} 字符为同类、同哈希分块的额外副本。相同内容不等于无用内容，应先核对是否有意重复。`,
        `Visible complete parts contain ${largest.total} characters; ${largest.duplicated} characters are additional copies of same-kind, same-hash parts. Identical content is not necessarily useless; first check whether repetition is intentional.`),
      evidenceIds: [largest.sample.refId, ...largest.duplicatedRefs],
      metrics: [metric('part_chars', '可见完整分块字符数', 'Visible complete part characters', largest.total, 'chars'),
        metric('duplicate_chars', '额外重复字符数', 'Additional duplicate characters', largest.duplicated, 'chars'),
        metric('duplicate_ratio', '额外重复比例', 'Additional duplicate share', largest.duplicated / largest.total, 'ratio')],
      recommendation: intervention('progressive_disclosure', text('先消除非必要副本或改为按需读取原文；保留必要约束，再验证输入规模和执行质量。',
        'Remove unnecessary copies or retrieve originals on demand; preserve required constraints and verify input size and execution quality.')) });
  }

  // A full request can expose a needlessly broad catalog without proving architectural coupling.
  const catalogs = input.contexts.filter(sample => sample.toolCatalogComplete && sample.tools.length >= thresholds.toolCatalogLimit);
  if (catalogs.length > 0) {
    const sample = catalogs.reduce((largest, candidate) => candidate.tools.length > largest.tools.length ? candidate : largest);
    add({ category: 'context_bloat', rule: 'large_tool_catalog', severity: 'info', confidence: 'observed',
      title: text('单次请求携带较大工具目录', 'A request carries a large tool catalog'),
      explanation: text(`完整可调用目录包含 ${sample.tools.length} 个声明，超过当前阈值 ${thresholds.toolCatalogLimit}。数量不是工具选择冲突的证明。`,
        `The complete callable catalog contains ${sample.tools.length} declarations, exceeding the current threshold ${thresholds.toolCatalogLimit}. Count alone does not prove tool-selection conflict.`),
      evidenceIds: [sample.refId, ...sample.tools.slice(0, 7).map(tool => tool.refId)],
      metrics: [metric('tool_count', '工具声明数量', 'Tool declarations', sample.tools.length, 'tools'),
        metric('catalog_limit', '目录阈值', 'Catalog threshold', thresholds.toolCatalogLimit, 'tools')],
      recommendation: intervention('progressive_disclosure', text('优先试用工具搜索、技能入口或按需加载，再比较选择准确率与输入规模。',
        'First try tool search, skill entry points, or deferred loading, then compare selection accuracy and input size.')) });
  }

  for (const sample of input.contexts) {
    if (!sample.toolCatalogComplete) uncertain.tool_conflict = true;
    if (sample.toolChoice.mode === 'unknown' || (sample.toolChoice.mode === 'named' && sample.toolChoice.name === null)) {
      uncertain.tool_conflict = true;
    }
    const definitions = new Map<string, typeof sample.tools>();
    for (const tool of sample.tools) {
      const list = definitions.get(tool.name) ?? []; list.push(tool); definitions.set(tool.name, list);
    }
    if (sample.toolCatalogComplete) for (const [name, tools] of definitions) {
      const signatures = unique(tools.map(tool => tool.signature));
      if (signatures.length <= 1) continue;
      add({ category: 'tool_conflict', rule: 'same_name_different_schema', severity: 'warning', confidence: 'observed',
        title: text('同名工具存在不同定义', 'One tool name has incompatible declarations'),
        explanation: text(`同一完整请求中，“${name.slice(0, 120)}”对应 ${signatures.length} 个不同 Schema 签名；这是声明歧义，尚不代表执行了错误工具。`,
          `Within one complete request, “${name.slice(0, 120)}” has ${signatures.length} distinct schema signatures. This is declaration ambiguity, not proof of an incorrect execution.`),
        evidenceIds: tools.map(tool => tool.refId),
        metrics: [metric('schema_count', '不同定义数', 'Distinct schemas', signatures.length, 'schemas')],
        recommendation: intervention('repair_tool_contract', text('统一定义或使用唯一名称，先修复可调用契约，再评估是否需要按专长隔离工具。',
          'Unify schemas or use unique names. Repair the callable contract before testing specialist tool isolation.')) });
    }
    for (const proposal of sample.proposals) {
      const tools = definitions.get(proposal.name) ?? [];
      const unknown = sample.toolCatalogComplete && tools.length === 0;
      const forced = sample.toolChoice.mode === 'none'
        || (sample.toolChoice.mode === 'named' && sample.toolChoice.name !== null && sample.toolChoice.name !== proposal.name);
      if (!proposal.argumentsComplete || proposal.argumentKeys === null) uncertain.tool_conflict = true;
      const argumentCheck = proposal.argumentsComplete && proposal.argumentKeys !== null && tools.length > 0
        && unique(tools.map(tool => tool.signature)).length === 1;
      const missing = argumentCheck
        ? unique(tools.flatMap(tool => tool.requiredArguments)).filter(key => !proposal.argumentKeys!.includes(key)) : [];
      if (!unknown && !forced && missing.length === 0) continue;
      const rule = unknown ? 'undeclared_tool_proposal' : forced ? 'forced_tool_choice_mismatch' : 'missing_required_arguments';
      add({ category: 'tool_conflict', rule, severity: 'warning', confidence: 'observed',
        title: unknown ? text('提议的工具不在完整目录中', 'A proposed tool is absent from the complete catalog')
          : forced ? text('工具提议违背明确选择约束', 'A tool proposal contradicts explicit tool choice')
            : text('工具提议缺少必填参数', 'A tool proposal omits required arguments'),
        explanation: text(
          `实际提议“${proposal.name.slice(0, 120)}”${unknown ? '不在该请求的完整可调用目录内' : forced ? '与该请求的 none / 指定名称约束不一致' : `缺少 ${missing.length} 个必填顶层参数：${missing.slice(0, 8).map(key => key.slice(0, 80)).join('、')}`}。这是提议事实，不是执行结果。`,
          `The actual proposal “${proposal.name.slice(0, 120)}” ${unknown ? 'is absent from this request’s complete callable catalog' : forced ? 'contradicts this request’s none / named choice' : `omits ${missing.length} required top-level arguments: ${missing.slice(0, 8).map(key => key.slice(0, 80)).join(', ')}`}. This is a proposal fact, not an execution result.`,
        ),
        evidenceIds: [proposal.refId, sample.refId, ...tools.map(tool => tool.refId)],
        metrics: [metric('proposals', '不一致提议', 'Inconsistent proposals', 1, 'proposals'),
          metric('missing_arguments', '缺失必填参数', 'Missing required arguments', argumentCheck ? missing.length : null, 'arguments')],
        recommendation: intervention('repair_tool_contract', text('对齐工具名称、参数和调用选择约束；用相同输入复测实际提议与工具执行结果。',
          'Align tool names, arguments, and choice constraints; rerun the same input and inspect actual proposals and execution outcomes.')) });
    }
  }
  // Explicit execution errors are separate from model proposals and generic failures.
  const errorGroups = new Map<string, typeof input.outcomes>();
  for (const outcome of input.outcomes) {
    if (outcome.status === 'unknown') uncertain.tool_conflict = true;
    if (outcome.status !== 'error' || !['unknown_tool', 'invalid_arguments'].includes(outcome.errorClass ?? '')) continue;
    const key = outcome.agentId === null
      ? `unattributed:${outcome.refId}:${outcome.errorClass}`
      : `${outcome.agentId}:${outcome.name}:${outcome.errorClass}`;
    const list = errorGroups.get(key) ?? [];
    if (!list.some(other => outcome.callId !== null
      ? other.callId === outcome.callId
      : outcome.decisionKey !== null ? other.decisionKey === outcome.decisionKey : other.refId === outcome.refId)) list.push(outcome);
    errorGroups.set(key, list);
  }
  for (const errors of errorGroups.values()) {
    const first = errors[0]!;
    const repeated = errors.length >= thresholds.repeatedToolErrors && first.agentId !== null;
    add({ category: 'tool_conflict', rule: repeated ? 'repeated_explicit_tool_errors' : 'explicit_tool_error',
      severity: repeated ? 'warning' : 'info', confidence: 'observed',
      title: repeated ? text('同一 Agent 重复出现明确工具契约错误', 'One agent repeatedly encounters explicit tool-contract errors')
        : text('记录到明确工具契约错误', 'An explicit tool-contract error was recorded'),
      explanation: text(`记录到 ${errors.length} 次去重后的 ${first.errorClass} 错误，工具“${first.name.slice(0, 120)}”。只计明确错误分类，不把权限、一般失败或工具名变化当作选择冲突。${first.agentId === null ? '该来源没有已验证的 Agent 归属，不能据此累计同一 Agent 的失败。' : ''}`,
        `${errors.length} deduplicated ${first.errorClass} error(s) were recorded for “${first.name.slice(0, 120)}”. Only explicit classifications count; permission errors, generic failures, and tool-name changes are not selection conflicts.${first.agentId === null ? ' Agent ownership is unverified; these records cannot establish repeated failure by one agent.' : ''}`),
      evidenceIds: errors.flatMap(error => [error.refId, ...(error.proposalRefId ? [error.proposalRefId] : [])]),
      metrics: [metric('explicit_errors', '明确错误次数', 'Explicit errors', errors.length, 'errors')],
      recommendation: intervention('repair_tool_contract', text('先检查名称解析、参数校验和运行时注册；只有契约修复后仍有专长冲突，才实验隔离工具集。',
        'First check name resolution, argument validation, and runtime registration; test specialist tool isolation only if conflicts remain after contract repair.')) });
  }
  if (input.contexts.length === 0 && input.outcomes.length === 0) uncertain.tool_conflict = true;

  const handoffGaps: Array<{ handoff: ArchitectureHandoff; missing: number; anchors: number }> = [];
  const seenHandoffs = new Set<string>();
  for (const handoff of input.handoffs) {
    const identity = JSON.stringify([handoff.sentRefId, handoff.receivedRefId]);
    if (seenHandoffs.has(identity)) continue;
    seenHandoffs.add(identity);
    if (handoff.linkage !== 'explicit' || handoff.recipientAgentId === null || handoff.recipientAgentId === handoff.senderAgentId
      || handoff.receivedRefId === null || !handoff.sentComplete || !handoff.receivedComplete
      || handoff.sentText === null || handoff.receivedText === null) {
      uncertain.handoff_loss = true; continue;
    }
    const received = normalize(handoff.receivedText);
    const required = handoff.requiredFacts.filter(fact => normalize(fact.value).length > 0);
    const literals = required.length > 0 ? required.map(fact => normalize(fact.value)) : anchors(handoff.sentText);
    const assessable = required.length > 0 || literals.length >= thresholds.minHandoffAnchors
      || normalize(handoff.sentText) === received;
    if (!assessable) { uncertain.handoff_loss = true; continue; }
    const missing = literals.filter(anchor => !received.includes(anchor));
    if (missing.length === 0) continue;
    handoffGaps.push({ handoff, missing: missing.length, anchors: literals.length });
    add({ category: 'handoff_loss', rule: required.length > 0 ? 'handoff_required_reference_gap' : 'handoff_literal_anchor_gap',
      severity: 'warning', confidence: 'heuristic',
      title: text('交接接收记录缺少原样引用', 'The received handoff omits literal references'),
      explanation: text(`显式发送与完整接收记录可配对；${literals.length} 个${required.length > 0 ? '明确要求引用' : '保守字面锚点'}中有 ${missing.length} 个未在接收文本中原样出现。这只是引用缺口：转述、额外上下文或其他渠道可能保留语义，不能据此确证信息丢失。`,
        `An explicit send is linked to complete received input; ${missing.length} of ${literals.length} ${required.length > 0 ? 'explicit required references' : 'conservative literal anchors'} do not appear verbatim. This is only a reference gap: paraphrases, additional context, or other channels may preserve meaning, so semantic loss is not established.`),
      evidenceIds: [handoff.sentRefId, handoff.receivedRefId, ...required.map(fact => fact.refId)],
      metrics: [metric('anchors', '可检查引用', 'Checkable references', literals.length, 'references'),
        metric('missing_literal_anchors', '未原样出现的引用', 'References absent verbatim', missing.length, 'references')],
      recommendation: intervention('verify_first', text('先检查双方完整原文，显式交付物是否需要保留这些引用，并用引用清单或接收确认验证含义。',
        'Inspect both originals, confirm whether the deliverable requires these references, and verify meaning with a reference checklist or receiver acknowledgment.')) });
  }
  const coupled = new Map<string, typeof handoffGaps>();
  for (const gap of handoffGaps) {
    const agents = [gap.handoff.senderAgentId, gap.handoff.recipientAgentId!].sort();
    const key = JSON.stringify(agents); const list = coupled.get(key) ?? []; list.push(gap); coupled.set(key, list);
  }
  const pairedHandoffs = new Set<string>();
  for (const gaps of coupled.values()) {
    if (gaps.length < 2) continue;
    gaps.forEach(gap => pairedHandoffs.add(gap.handoff.id));
    add({ category: 'handoff_loss', rule: 'repeated_handoff_reference_gaps', severity: 'info', confidence: 'heuristic',
      title: text('同一对 Agent 多次出现交接引用缺口', 'One agent pair has repeated handoff reference gaps'),
      explanation: text(`同一对 Agent 的 ${gaps.length} 次显式交接出现原样引用缺口。这提示检查边界是否过细；缺口和交接频率均不能单独证明这些步骤紧耦合。`,
        `${gaps.length} explicit handoffs within one agent pair have literal reference gaps. Inspect whether the boundary is too fine; neither gaps nor exchange frequency alone proves tight coupling.`),
      evidenceIds: gaps.flatMap(gap => [gap.handoff.sentRefId, gap.handoff.receivedRefId!]),
      metrics: [metric('handoffs_with_gaps', '有引用缺口的交接', 'Handoffs with reference gaps', gaps.length, 'handoffs')],
      recommendation: intervention('merge_candidate', text('如果双方需要反复共享同一中间状态，可试把强依赖步骤合回主循环，并保留独立验证。',
        'If both sides repeatedly require the same intermediate state, test merging dependent steps into the main loop while preserving independent verification.')) });
  }
  const delegations = new Map<string, typeof handoffGaps>();
  for (const gap of handoffGaps) {
    if (pairedHandoffs.has(gap.handoff.id)) continue;
    const key = gap.handoff.senderAgentId;
    const list = delegations.get(key) ?? []; list.push(gap); delegations.set(key, list);
  }
  for (const gaps of delegations.values()) {
    const recipients = unique(gaps.map(gap => gap.handoff.recipientAgentId));
    if (recipients.length < 2) continue;
    add({ category: 'handoff_loss', rule: 'repeated_delegation_reference_gaps', severity: 'info', confidence: 'heuristic',
      title: text('同一主 Agent 的多次委派出现引用缺口', 'One lead agent has reference gaps across delegation boundaries'),
      explanation: text(`同一发送方对 ${recipients.length} 个不同接收方的 ${gaps.length} 次显式完整交接出现引用缺口。这是可检查的边界问题线索，不证明子任务强耦合、摘要错误或语义丢失。`,
        `${gaps.length} explicit complete handoffs from one sender to ${recipients.length} distinct recipients have reference gaps. This is a boundary-review signal, not proof of tight coupling, incorrect summaries, or semantic loss.`),
      evidenceIds: gaps.flatMap(gap => [gap.handoff.sentRefId, gap.handoff.receivedRefId!]),
      metrics: [metric('delegations_with_gaps', '有引用缺口的委派', 'Delegations with reference gaps', gaps.length, 'handoffs'),
        metric('recipients', '不同接收方', 'Distinct recipients', recipients.length, 'agents')],
      recommendation: intervention('merge_candidate', text('先逐一验证缺口是否影响必要信息；若这些委派反复依赖主循环的同一细节，可实验把相关步骤合回主循环。',
        'First verify whether each gap affects required information; if these delegations repeatedly depend on the same detailed main-loop state, test bringing the related steps back into that loop.')) });
  }

  for (const [category, coverage] of [
    ['context_bloat', input.coverage.context], ['tool_conflict', input.coverage.tools], ['handoff_loss', input.coverage.handoffs],
  ] as const) {
    if (coverage !== 'complete' || uncertain[category]) limitations.push(text(
      `${category} 的证据覆盖不完整或缺少可比较事实；未发现问题不能视为整个任务没有问题。`,
      `${category} has incomplete coverage or lacks comparable facts; absence of a finding does not certify the whole task.`,
    ));
  }
  const report: ArchitectureDiagnosisReport = {
    version: 1, taskId: input.taskId, title: input.title, member: input.member, origin: input.origin,
    revision: input.revision, analyzedAt: new Date(analyzedAt).toISOString(), thresholds,
    coverage: { ...input.coverage, reasons: [...input.coverage.reasons] },
    categories: { context_bloat: 'insufficient', tool_conflict: 'insufficient', handoff_loss: 'insufficient' },
    findings: [], evidence: [], limitations,
  };
  // Round-robin prevents one noisy category from hiding all other categories under the cap.
  const queues = CATEGORIES.map(category => findings.filter(finding => finding.category === category));
  let omitted = candidateOmitted;
  while (queues.some(queue => queue.length > 0)) {
    for (const queue of queues) {
      const finding = queue.shift(); if (!finding) continue;
      if (report.findings.length >= LIMITS.findings) { omitted += 1; continue; }
      report.findings.push(finding);
    }
  }
  const projectEvidence = () => {
    const used = new Set(report.findings.flatMap(finding => finding.evidenceIds));
    report.evidence = [...used].map(id => {
      const ref = refs.get(id)!;
      return { ...ref, excerpt: ref.excerpt === null ? null : ref.excerpt.slice(0, 240) };
    });
  };
  projectEvidence();
  // Reserve room for the explicit omission notice and category states.
  while (new TextEncoder().encode(JSON.stringify(report)).byteLength > LIMITS.bytes - 2048 && report.findings.length > 0) {
    report.findings.pop(); omitted += 1; projectEvidence();
  }
  if (omitted > 0) {
    report.coverage.omitted += omitted;
    report.coverage.reasons.push(`diagnosis_report_limit:${omitted}`);
    report.limitations.push(text(`报告上限省略了 ${omitted} 项发现；当前报告不保证列出全部可见问题。`,
      `The report limit omitted ${omitted} findings; this report does not enumerate every visible issue.`));
  }
  const coverage = { context_bloat: input.coverage.context, tool_conflict: input.coverage.tools, handoff_loss: input.coverage.handoffs };
  for (const category of CATEGORIES) report.categories[category] = report.findings.some(finding => finding.category === category)
    ? 'findings' : coverage[category] === 'complete' && !uncertain[category] && detected[category] === 0
      ? 'not_observed' : 'insufficient';
  return report;
}
