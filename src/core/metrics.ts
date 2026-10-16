import type {
  TraceEvent,
  TraceMetrics,
  TracePhase,
  TraceRecord,
} from './trace-types.js';
import { TRACE_PHASES } from './trace-types.js';
import { computeSpeedMetrics } from './speed-metrics.js';
import { isWriteEventLike } from './event-groups.js';
import { commandTextOf, promptTextOf } from './phase-classifier.js';

/**
 * REQ-005：算法变更时 bump，触发 metrics 重算回写。
 * v2（2026-08-04）：#14 errorRate 分母改为步骤事件数；#15 verificationCoverage 改为
 * verify 事件数 / totalSteps 比例（不再是 0|1 二值）。
 * v3（add-mission-control）：metrics 持久化 ttft_ms / e2e_ms（§4 B6，G11.11）
 * 与 repair_loop（§7.3 R1：repair 检测升级为扫描时预计算）。
 * v4（calibrate-tokens-and-compare-report §4）：TraceMetrics 新增
 * totalToolDurationMs / llmCallCount / userInteractionRounds / hasUnitTests /
 * failedCommandCount —— 必须 bump，否则老行 calc_version=3 永不重算。
 * v5（2026-08-11 校准审计）：#A userInteractionRounds 改为过滤系统注入
 * （此前把 <system-reminder> 当用户轮次，CodeArts 虚高 2×、Trae 虚高 2.7×）；
 * #B hasUnitTests 的 TEST_CMD 补 JVM/.NET 跑测命令并读真实命令文本；
 * #C phase 分类修好后 verify/debug 首次产出非零值，依赖 phase 的
 * verificationPresent / verificationCoverage / enteredDebug 全部要重算。
 */
export const METRICS_CALC_VERSION = 5;

/** repair_loop 判定：连续 W F W F W（write, fail, write, fail, write），≥2 轮。
 * 与 event-groups detectRepairLoop 的 isWriteEventLike + (bash|test)+error 同口径。 */
function detectRepairLoop(events: TraceEvent[]): boolean {
  const sorted = events
    .slice()
    .sort((a, b) => (a.startedAt === b.startedAt ? a.sequence - b.sequence : a.startedAt < b.startedAt ? -1 : 1));
  const isFail = (e: TraceEvent): boolean =>
    (e.kind === 'bash' || e.kind === 'test') && e.status === 'error';
  for (let i = 0; i + 4 < sorted.length; i += 1) {
    if (
      isWriteEventLike(sorted[i]!) &&
      isFail(sorted[i + 1]!) &&
      isWriteEventLike(sorted[i + 2]!) &&
      isFail(sorted[i + 3]!) &&
      isWriteEventLike(sorted[i + 4]!)
    ) {
      return true;
    }
  }
  return false;
}

const STEP_KINDS = new Set([
  'llm',
  'tool',
  'file_read',
  'file_write',
  'bash',
  'test',
  'agent',
]);

/**
 * v4 hasUnitTests：命中测试命令正则。与 trae.ts 的 TEST_CMD 同口径
 * （npm test / vitest / jest / pytest / cargo test / go test / tsc / eslint）。
 *
 * v5：补 JVM / .NET / Ruby 跑测命令。**故意比 phase-classifier 的 VERIFY_CMD 窄** ——
 * 这里问的是「有没有跑单元测试」，`mvn compile` / `mvn install -DskipTests` 是构建
 * 不是测试，必须判 false（2026-08-09 实测两个智能体都没写测试，此处必须保持 0）。
 */
const TEST_CMD =
  /(npm test|vitest|jest|pytest|cargo test|go test|tsc|eslint|\b(mvn|gradle|gradlew)\b[^\n]*\btest\b|dotnet test|\bctest\b|\brspec\b|\bphpunit\b)/;

/** v4 failedCommandCount：命令失败计数的事件种类（有意不含 llm）。 */
const FAILED_COMMAND_KINDS = new Set([
  'bash',
  'test',
  'tool',
  'file_write',
  'file_read',
  'agent',
]);

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** REQ-004：四维指标 + 基础指标。 */
export function computeMetrics(record: TraceRecord): TraceMetrics {
  const events = record.events;
  // fix-adapter-turn-semantics A8/5.9：compact 是基础设施事件，不是 agent 工作，
  // 从 avgToolDurationMs 与 errorRate（分子分母）显式排除；与 overview.ts 的
  // SQL 聚合路径同口径（consistency.test.ts REQ-011 锁定两路一致 ≤0.001）。
  const toolEvents = events.filter((e) => e.tool !== null && e.kind !== 'compact');
  // STEP_KINDS 本身不含 compact，errorRate 分母/分子天然排除；
  // 下方显式追加过滤仅为防止未来 STEP_KINDS 改动破坏口径。
  const totalSteps = events.filter((e) => STEP_KINDS.has(e.kind)).length;
  const errorSteps = events.filter(
    (e) => e.status === 'error' && STEP_KINDS.has(e.kind) && e.kind !== 'compact',
  ).length;
  const verifyEventCount = events.filter((e) => e.phase === 'verify').length;

  const durationByPhase = Object.fromEntries(
    TRACE_PHASES.map((phase) => [phase, 0]),
  ) as Record<TracePhase, number>;
  for (const event of events) {
    durationByPhase[event.phase] += event.durationMs;
  }

  const verificationPresent = events.some((e) => e.phase === 'verify');
  const enteredDebug = events.some((e) => e.phase === 'debug');
  const speed = computeSpeedMetrics(record);
  // §4（calibrate-tokens-and-compare-report）：五个新字段。
  const totalToolDurationMs = events
    .filter((e) => e.tool !== null)
    .reduce((sum, e) => sum + e.durationMs, 0);
  const llmCallCount = events.filter((e) => e.kind === 'llm').length;
  // v5：只数**真人**发的轮次。此前直接数 user_prompt，把 <system-reminder>、
  // skill 提醒、子代理派单这些系统注入全算成了「用户又说了一句话」——
  // 2026-08-09 实测 CodeArts 7 轮被记成 14、Trae 3 轮被记成 8，
  // 「平均每轮成本 / 每轮耗时」这类派生指标随之全部腰斩。
  const userInteractionRounds = events.filter(
    (e) => e.kind === 'user_prompt' && isGenuineUserPrompt(promptTextOf(e)),
  ).length;
  // v5：judge 的是命令文本而不是 title（title 多为模型写的人类描述）。
  const hasUnitTests = events.some(
    (e) => e.phase === 'verify' && TEST_CMD.test(commandTextOf(e)),
  );
  const failedCommandCount = events.filter(
    (e) => e.status === 'error' && FAILED_COMMAND_KINDS.has(e.kind),
  ).length;
  return {
    totalSteps,
    durationByPhase,
    toolCallCount: toolEvents.length,
    verificationPresent,
    calcVersion: METRICS_CALC_VERSION,
    avgToolDurationMs: mean(toolEvents.map((e) => e.durationMs)),
    // #15：覆盖比例 = verify 事件数 / 步骤数（50 步 1 次验证 = 0.02，不再恒为 1）。
    verificationCoverage: totalSteps === 0 ? 0 : verifyEventCount / totalSteps,
    // #14：errorRate 只衡量执行步骤的失败率，分母为 STEP_KINDS 事件数。
    errorRate: totalSteps === 0 ? 0 : errorSteps / totalSteps,
    enteredDebug,
    tokensPerStep: totalSteps === 0 ? 0 : record.session.tokenUsage.total / totalSteps,
    costUsd: record.session.costUsd,
    ttftMs: speed.ttftMs,
    e2eMs: speed.e2eMs,
    repairLoop: detectRepairLoop(events),
    totalToolDurationMs,
    llmCallCount,
    userInteractionRounds,
    hasUnitTests,
    failedCommandCount,
  };
}

/**
 * REQ-010：过滤 <system-reminder> 等系统注入。
 *
 * 必须同时认**闭标签**：Trae 落库的注入消息正文被前端截去了开头，只剩
 * `…as your first action.\n</system-reminder>\n\n实际派单内容`，
 * 只匹配开标签会把它们全部当成真人输入。
 */
export function isGenuineUserPrompt(text: string): boolean {
  return !/<\/?system-reminder>|system_reminder|<\/?system>/i.test(text);
}

/** REQ-010：清理标签。 */
export function cleanPromptText(text: string): string {
  return text
    .replace(/<user_query>|<\/user_query>/gi, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<system>[\s\S]*?<\/system>/gi, '')
    .trim();
}
