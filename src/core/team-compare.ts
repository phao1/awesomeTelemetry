/**
 * Deterministic team comparison (add-agent-team-observability §6.7–6.8, design D10).
 *
 * 纯函数模块：只接收规范输入、输出规范类型，不读 DB、不发请求、不写文件。
 * 比较必须确定性：无模型调用、无 winner、无总体 score，只有维度行（raw 左右值 +
 * right-minus-left delta + guarded relative delta + directionality + materiality +
 * criteria + completeness + evidence）+ strengths / weaknesses / tradeoffs / caveats。
 */
import type {
  CompletenessLevel,
  TeamComparison,
  TeamComparisonBasis,
  TeamComparisonDimension,
  TeamComparisonMetricRow,
  TeamMetricDimension,
  TeamMetricDirection,
  TeamMetrics,
  TeamMetricValue,
} from './trace-types.js';
import { TEAM_METRIC_DIRECTIONS } from './team-metrics.js';

/** materiality 阈值：相对变化 ≥ 10% 才算 material（design D10）。 */
export const TEAM_MATERIALITY_THRESHOLD = 0.1;

/** 每个维度包含的指标 id（顺序 = 展示顺序）。 */
export const DIMENSION_METRIC_IDS: Readonly<Record<TeamMetricDimension, readonly string[]>> = {
  speed: [
    'wallClockMs',
    'agentActiveMs',
    'totalWorkMs',
    'observedWaitMs',
    'maxConcurrency',
    'avgConcurrency',
    'serialWorkEstimateMs',
    'observedSpeedup',
    'peakCapacityUtilization',
    'criticalPathMs',
    'delegationDelayMs',
    'handoffLatencyMs',
  ],
  accuracy: [
    'taskCompletion',
    'verificationCoverage',
    'acceptanceCoverage',
    'reviewRework',
    'acceptedArtifactRate',
  ],
  stability: [
    'failures',
    'retries',
    'replacements',
    'recoveryLatencyMs',
    'blockedOrphanTimeMs',
    'unresolvedErrors',
    'dagAnomalies',
    'incompleteTerminalStates',
  ],
  cost: [
    'totalInputTokens',
    'totalOutputTokens',
    'totalReasoningTokens',
    'totalCacheReadTokens',
    'totalCacheWriteTokens',
    'totalCostUsd',
    'coordinationTokens',
    'costGini',
  ],
  collaboration: [
    'directRatio',
    'leaderMediatedRatio',
    'responseLatencyMedianMs',
    'responseLatencyP95Ms',
    'taskBalanceGini',
    'leaderWorkConcentration',
    'criticalAgentConcentration',
    'crossAgentReview',
    'duplicateWorkSignal',
  ],
};

const DIMENSION_ORDER: readonly TeamMetricDimension[] = [
  'speed',
  'accuracy',
  'stability',
  'cost',
  'collaboration',
];

function unavailableMetric(): TeamMetricValue {
  return {
    value: null,
    available: false,
    complete: false,
    criteria: '',
    evidenceIds: [],
    numerator: null,
    denominator: null,
  };
}

/** 把 TeamMetrics 扁平化为 metricId → TeamMetricValue。 */
function flattenMetrics(metrics: TeamMetrics): Map<string, TeamMetricValue> {
  const map = new Map<string, TeamMetricValue>();
  for (const [key, value] of Object.entries(metrics.scheduling)) {
    map.set(key, value as TeamMetricValue);
  }
  for (const [key, value] of Object.entries(metrics.quality)) {
    map.set(key, value as TeamMetricValue);
  }
  for (const [key, value] of Object.entries(metrics.stability)) {
    map.set(key, value as TeamMetricValue);
  }
  for (const [key, value] of Object.entries(metrics.cost)) {
    if (key === 'costCurrency') {
      continue;
    }
    map.set(key, value as TeamMetricValue);
  }
  for (const [key, value] of Object.entries(metrics.collaboration)) {
    map.set(key, value as TeamMetricValue);
  }
  return map;
}

/** 组合左右 completeness（level）。 */
function combineCompleteness(left: TeamMetricValue, right: TeamMetricValue): CompletenessLevel {
  const leftAvailable = left.value !== null;
  const rightAvailable = right.value !== null;
  if (!leftAvailable && !rightAvailable) {
    return 'unavailable';
  }
  if (left.complete && right.complete) {
    return 'complete';
  }
  return 'partial';
}

/** 方向感知的 material 判定（guarded，无 infinity / 0 冒充）。 */
function isMaterial(
  delta: number | null,
  relativeDelta: number | null,
  completeness: CompletenessLevel,
): boolean {
  if (completeness === 'unavailable' || delta === null) {
    return false;
  }
  if (relativeDelta !== null) {
    return Math.abs(relativeDelta) >= TEAM_MATERIALITY_THRESHOLD;
  }
  // relativeDelta 为 null（left 为 0 / 非有限）：绝对变化非零即 material（从无到有）。
  return Math.abs(delta) >= 1e-9;
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function buildRow(
  metricId: string,
  dimension: TeamMetricDimension,
  left: TeamMetricValue,
  right: TeamMetricValue,
): TeamComparisonMetricRow {
  const direction: TeamMetricDirection = TEAM_METRIC_DIRECTIONS[metricId] ?? 'descriptive';
  const criteria = left.criteria !== '' ? left.criteria : right.criteria;

  let delta: number | null = null;
  if (left.value !== null && right.value !== null) {
    delta = right.value - left.value;
  }
  let relativeDelta: number | null = null;
  if (
    delta !== null &&
    left.value !== null &&
    Number.isFinite(left.value) &&
    left.value !== 0
  ) {
    relativeDelta = delta / left.value;
  }

  const completeness = combineCompleteness(left, right);
  const material = isMaterial(delta, relativeDelta, completeness);

  return {
    metricId,
    dimension,
    criteria,
    direction,
    left,
    right,
    delta,
    relativeDelta,
    material,
    completeness,
    evidenceIds: dedupe([...left.evidenceIds, ...right.evidenceIds]),
  };
}

/**
 * 构建五维比较行（§6.7）：raw 左右值 + right−left delta + guarded relative delta
 * + 方向 + materiality + criteria + completeness + evidence。
 */
export function buildComparisonDimensions(
  left: TeamMetrics,
  right: TeamMetrics,
): TeamComparisonDimension[] {
  const leftMap = flattenMetrics(left);
  const rightMap = flattenMetrics(right);
  const dimensions: TeamComparisonDimension[] = [];
  for (const dimension of DIMENSION_ORDER) {
    const rows = DIMENSION_METRIC_IDS[dimension].map((metricId) =>
      buildRow(metricId, dimension, leftMap.get(metricId) ?? unavailableMetric(), rightMap.get(metricId) ?? unavailableMetric()),
    );
    dimensions.push({ dimension, rows });
  }
  return dimensions;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 10000) / 10000);
}

/** 确定性句子（无 LLM）。 */
function describeRow(row: TeamComparisonMetricRow): string {
  const pct = row.relativeDelta !== null ? `${(row.relativeDelta * 100).toFixed(1)}%` : 'n/a';
  const leftStr = row.left.value === null ? 'n/a' : formatNumber(row.left.value);
  const rightStr = row.right.value === null ? 'n/a' : formatNumber(row.right.value);
  return `${row.metricId} ${pct} (left ${leftStr} → right ${rightStr})`;
}

function materialMagnitude(row: TeamComparisonMetricRow): number {
  if (row.relativeDelta !== null) {
    return Math.abs(row.relativeDelta);
  }
  return Math.abs(row.delta ?? 0);
}

interface Verdicts {
  strengths: string[];
  weaknesses: string[];
  tradeoffs: string[];
  caveats: string[];
}

/**
 * 确定性 strengths / weaknesses / tradeoffs / caveats（§6.8，design D10）：
 * - strengths：右比左在方向感知下 material 更优；
 * - weaknesses：右比左 material 更差；
 * - tradeoffs：descriptive 指标的 material 变化；
 * - caveats：每个至少一侧 unavailable 的维度 + 每侧 partial 的维度。
 * 无模型调用、无 winner、无总评分。
 */
function buildVerdicts(dimensions: readonly TeamComparisonDimension[]): Verdicts {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const tradeoffs: string[] = [];
  const caveats: string[] = [];

  for (const dimension of dimensions) {
    const materialRows = dimension.rows.filter((row) => row.material);
    const descriptive = materialRows.filter((row) => row.direction === 'descriptive');
    const directional = materialRows.filter((row) => row.direction !== 'descriptive');

    for (const row of descriptive) {
      tradeoffs.push(describeRow(row));
    }

    let bestStrength: TeamComparisonMetricRow | null = null;
    let bestWeakness: TeamComparisonMetricRow | null = null;
    for (const row of directional) {
      const delta = row.delta;
      if (delta === null) {
        continue;
      }
      const rightBetter = row.direction === 'higher_better' ? delta > 0 : delta < 0;
      if (rightBetter) {
        if (!bestStrength || materialMagnitude(row) > materialMagnitude(bestStrength)) {
          bestStrength = row;
        }
      } else if (delta !== 0) {
        if (!bestWeakness || materialMagnitude(row) > materialMagnitude(bestWeakness)) {
          bestWeakness = row;
        }
      }
    }
    if (bestStrength) {
      strengths.push(describeRow(bestStrength));
    }
    if (bestWeakness) {
      weaknesses.push(describeRow(bestWeakness));
    }

    // caveats：维度整列 unavailable 或 partial。
    const unavailableCount = dimension.rows.filter((row) => row.completeness === 'unavailable').length;
    if (unavailableCount === dimension.rows.length) {
      caveats.push(`${dimension.dimension} dimension unavailable in at least one run`);
    } else if (dimension.rows.some((row) => row.completeness === 'partial')) {
      caveats.push(`${dimension.dimension} dimension is only partially complete`);
    }
  }

  return { strengths, weaknesses, tradeoffs, caveats };
}

export interface TeamCompareInput {
  leftRunId: string;
  rightRunId: string;
  left: TeamMetrics;
  right: TeamMetrics;
  basis: TeamComparisonBasis;
  generatedAt: string;
}

/**
 * 两 run 比较（design D10）。unmatched/unknown 仍是成功响应，不是错误；
 * userDeclared basis 不抹除检测到的差异。输出无 winner、无总评分。
 */
export function compareTeams(input: TeamCompareInput): TeamComparison {
  const dimensions = buildComparisonDimensions(input.left, input.right);
  const verdicts = buildVerdicts(dimensions);
  return {
    leftRunId: input.leftRunId,
    rightRunId: input.rightRunId,
    basis: input.basis,
    dimensions,
    strengths: verdicts.strengths,
    weaknesses: verdicts.weaknesses,
    tradeoffs: verdicts.tradeoffs,
    caveats: verdicts.caveats,
    generatedAt: input.generatedAt,
  };
}
