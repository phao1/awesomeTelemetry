import type { TraceEvent, TraceEventSlim, TracePhase, TraceSession } from './trace-types.js';
import { TRACE_PHASES } from './trace-types.js';
import { extractPath, groupEvents, isReadEventLike, isWriteEventLike, type GanttRow } from './event-groups.js';
import { computeTimeComposition } from './time-composition.js';
import { computeSpeedMetrics } from './speed-metrics.js';

/**
 * ui-design-v2 §3.1 会话诊断卡。首批 10 条规则，全部只依赖已有 slim 数据。
 * 本模块保持 locale-free（tsconfig.node 也会编译 src/core），
 * 文案由组件层 `findings-text.ts` 按 locale 拼装。
 */
export type FindingSeverity = 'critical' | 'warning' | 'notice' | 'info';
export type FindingCategory = 'time' | 'token' | 'quality' | 'stability';

export type FindingKind =
  | 'phaseDominant'
  | 'longEvent'
  | 'repairLoop'
  | 'blindWrite'
  | 'noVerify'
  | 'toolFail'
  | 'sysPromptRepeat'
  | 'idleHigh'
  | 'ttft'
  | 'manyInterventions';

export interface Finding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  kind: FindingKind;
  /** 数字与名字证据，供文案模板替换（files 等可为数组）。 */
  data: Record<string, unknown>;
  evidence: {
    eventIds: string[];
    phase?: TracePhase;
    metric?: { key: string; value: number; unit: string };
  };
}

export interface FindingsResult {
  findings: Finding[];
  totalChecks: number;
  passed: number;
}

export function fmtDur(ms: number): string {
  if (ms <= 0) {
    return '0s';
  }
  const seconds = ms / 1000;
  // 指挥中心的 E2E 分位数动辄上千万毫秒（实测 e2eP99 ≈ 34 小时），
  // 只分到分钟会得到 "2071m"，同样要用户心算。
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const restMinutes = Math.round((seconds % 3600) / 60);
    return restMinutes > 0 ? `${hours}h${restMinutes}m` : `${hours}h`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return rest > 0 ? `${minutes}m${rest}s` : `${minutes}m`;
  }
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function severityRank(severity: FindingSeverity): number {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : severity === 'notice' ? 2 : 3;
}

export function computeFindings(
  session: TraceSession,
  events: TraceEventSlim[],
): FindingsResult {
  const findings: Finding[] = [];
  const totalChecks = 10;
  const add = (finding: Finding | null): void => {
    if (finding !== null) {
      findings.push(finding);
    }
  };

  const sorted = [...events].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const totalDur = events.reduce((sum, e) => sum + e.durationMs, 0);
  const composition = computeTimeComposition(events);
  const speed = computeSpeedMetrics({
    session,
    events: events as TraceEvent[],
    tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
    // v7 未持久化 provenance；B 阶段由 API 提供真实值
    turnKeySource: 'unavailable',
  });

  // 1. 单阶段时间占比过高（> 50% 总时长）
  if (totalDur > 0) {
    const byPhase = new Map<TracePhase, { ms: number; ids: string[] }>();
    for (const e of events) {
      const current = byPhase.get(e.phase) ?? { ms: 0, ids: [] };
      current.ms += e.durationMs;
      current.ids.push(e.id);
      byPhase.set(e.phase, current);
    }
    let top: TracePhase | null = null;
    let topPct = 0;
    for (const phase of TRACE_PHASES) {
      const value = byPhase.get(phase);
      if (value !== undefined && value.ms / totalDur > topPct) {
        topPct = value.ms / totalDur;
        top = phase;
      }
    }
    if (top !== null && topPct > 0.5) {
      const ids = byPhase.get(top)!.ids;
      add({
        id: 'rule-1',
        severity: 'warning',
        category: 'time',
        kind: 'phaseDominant',
        data: { phase: top, pct: (topPct * 100).toFixed(0), durMs: byPhase.get(top)!.ms, totalMs: totalDur, count: ids.length },
        evidence: { eventIds: ids, phase: top, metric: { key: 'phasePct', value: topPct * 100, unit: '%' } },
      });
    }
  }

  // 2. 存在超长单事件（> 20% 总时长）
  if (totalDur > 0) {
    let longest: TraceEventSlim | null = null;
    for (const e of events) {
      if (e.durationMs > totalDur * 0.2 && (longest === null || e.durationMs > longest.durationMs)) {
        longest = e;
      }
    }
    if (longest !== null) {
      add({
        id: 'rule-2',
        severity: 'warning',
        category: 'time',
        kind: 'longEvent',
        data: { durMs: longest.durationMs, pct: ((longest.durationMs / totalDur) * 100).toFixed(0), title: longest.title },
        evidence: { eventIds: [longest.id], metric: { key: 'durationMs', value: longest.durationMs, unit: 'ms' } },
      });
    }
  }

  // 3. 修复循环（≥2 轮 edit→fail→edit）
  const loops = groupEvents(events).filter(
    (row): row is Extract<GanttRow, { kind: 'group' }> =>
      row.kind === 'group' && row.group.type === 'repair_loop',
  );
  if (loops.length > 0) {
    const rounds = loops.reduce((sum, row) => sum + (row.group.rounds ?? 0), 0);
    const steps = loops.reduce((sum, row) => sum + row.group.stepCount, 0);
    add({
      id: 'rule-3',
      severity: 'critical',
      category: 'quality',
      kind: 'repairLoop',
      data: { rounds, groups: loops.length, steps },
      evidence: { eventIds: loops.flatMap((row) => row.group.eventIds) },
    });
  }

  // 4. 盲写文件：Write/Edit 前无 Read
  if (events.length > 0) {
    const readPaths = new Set<string>();
    const blind: Array<{ path: string; id: string }> = [];
    for (const e of sorted) {
      if (isReadEventLike(e)) {
        const path = extractPath(e.title);
        if (path !== null) {
          readPaths.add(path);
        }
      } else if (isWriteEventLike(e)) {
        const path = extractPath(e.title);
        if (path !== null && !readPaths.has(path)) {
          blind.push({ path, id: e.id });
        }
      }
    }
    if (blind.length > 0) {
      add({
        id: 'rule-4',
        severity: 'warning',
        category: 'quality',
        kind: 'blindWrite',
        data: { count: blind.length, files: blind.slice(0, 3).map((b) => b.path.split('/').pop() ?? b.path) },
        evidence: { eventIds: blind.map((b) => b.id) },
      });
    }
  }

  // 5. 无验证收尾
  if (events.length > 0 && !events.some((e) => e.phase === 'verify')) {
    add({
      id: 'rule-5',
      severity: 'critical',
      category: 'quality',
      kind: 'noVerify',
      data: {},
      evidence: { eventIds: [] },
    });
  }

  // 6. 工具失败率高（任一工具失败率 > 30% 且调用 ≥3）
  const byTool = new Map<string, { calls: number; fails: number; failIds: string[] }>();
  for (const e of events) {
    if (e.tool === null) {
      continue;
    }
    const key = e.tool.toLowerCase();
    const current = byTool.get(key) ?? { calls: 0, fails: 0, failIds: [] };
    current.calls += 1;
    if (e.status === 'error') {
      current.fails += 1;
      current.failIds.push(e.id);
    }
    byTool.set(key, current);
  }
  for (const [tool, value] of byTool) {
    if (value.calls >= 3 && value.fails / value.calls > 0.3) {
      add({
        id: `rule-6-${tool}`,
        severity: 'warning',
        category: 'stability',
        kind: 'toolFail',
        data: { tool, pct: ((value.fails / value.calls) * 100).toFixed(0), fails: value.fails, calls: value.calls },
        evidence: { eventIds: value.failIds },
      });
    }
  }

  // 7. 系统提示词重复占比（近似：首条 llm 输入为基线，其后输入视为重复发送）
  const llmWithTokens = events.filter((e) => e.kind === 'llm' && e.tokens !== null);
  if (llmWithTokens.length >= 2) {
    let totalInput = 0;
    let repeated = 0;
    llmWithTokens.forEach((e, index) => {
      const input = e.tokens!.input;
      totalInput += input;
      if (index > 0) {
        repeated += input;
      }
    });
    if (totalInput > 0 && repeated / totalInput > 0.3) {
      add({
        id: 'rule-7',
        severity: 'notice',
        category: 'token',
        kind: 'sysPromptRepeat',
        data: { pct: ((repeated / totalInput) * 100).toFixed(0), sends: llmWithTokens.length },
        evidence: { eventIds: llmWithTokens.map((e) => e.id) },
      });
    }
  }

  // 8. 空转时间过长（> 15% 总时长）
  if (composition.totalMs > 0 && composition.idleMs / composition.totalMs > 0.15) {
    add({
      id: 'rule-8',
      severity: 'notice',
      category: 'time',
      kind: 'idleHigh',
      data: { pct: ((composition.idleMs / composition.totalMs) * 100).toFixed(0), durMs: composition.idleMs },
      evidence: { eventIds: [], metric: { key: 'idleMs', value: composition.idleMs, unit: 'ms' } },
    });
  }

  // 9. 首 Token 慢（TTFT > 5s）
  if (speed.ttftMs !== null && speed.ttftMs > 5000) {
    add({
      id: 'rule-9',
      severity: 'notice',
      category: 'time',
      kind: 'ttft',
      data: { durMs: speed.ttftMs },
      evidence: { eventIds: [], metric: { key: 'ttftMs', value: speed.ttftMs, unit: 'ms' } },
    });
  }

  // 10. 用户被迫多轮介入（user_prompt ≥ 4）
  const userPromptCount = events.filter((e) => e.kind === 'user_prompt').length;
  if (userPromptCount >= 4) {
    add({
      id: 'rule-10',
      severity: 'warning',
      category: 'stability',
      kind: 'manyInterventions',
      data: { count: userPromptCount },
      evidence: { eventIds: [] },
    });
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  return { findings, totalChecks, passed: totalChecks - findings.length };
}
