import type { TraceEvent, TracePhase } from './trace-types.js';

/**
 * REQ-001（metrics-analysis）：Phase 两遍分类算法。
 * Pass 1：explicit（action 直接映射）/ meta（system）/ propagate（message、reasoning、function_call、llm、agent）
 * Pass 2：propagate 与 meta 继承最近 explicit 的 phase；前后取近者，LLM 偏前，agent 与 message 偏后。
 */

const VERIFY_CMD = /(npm test|vitest|jest|pytest|cargo test|go test|tsc|eslint)/;
const REPORT_CMD = /(^|\s)(git commit|git push|gh pr|git pr|gh issue)/;
const UNDERSTAND_CMD = /(^|\s)(cat|ls|find|grep|rg|head|tail|less|more|jq|stat)/;
const IMPLEMENT_CMD = /(^|\s)(rm|cp|mv|mkdir|touch|git add|sed|awk|echo)/;

export type BashCommandClass =
  | 'verify'
  | 'report'
  | 'understand'
  | 'implement'
  | 'other';

/** REQ-003：bash 命令按正则分四类。 */
export function classifyBashCommand(cmd: string): BashCommandClass {
  if (VERIFY_CMD.test(cmd)) {
    return 'verify';
  }
  if (REPORT_CMD.test(cmd)) {
    return 'report';
  }
  if (UNDERSTAND_CMD.test(cmd)) {
    return 'understand';
  }
  if (IMPLEMENT_CMD.test(cmd)) {
    return 'implement';
  }
  return 'other';
}

/** REQ-002：ACTION_PHASE 查找表（约 30 个 action 名）。 */
const ACTION_PHASE: Record<string, TracePhase> = {
  read: 'understand',
  read_file: 'understand',
  glob: 'understand',
  grep: 'understand',
  search: 'understand',
  list: 'understand',
  ls: 'understand',
  find: 'understand',
  cat: 'understand',
  view: 'understand',
  fetch: 'understand',
  web: 'understand',
  write: 'implement',
  write_file: 'implement',
  edit: 'implement',
  edit_file: 'implement',
  patch: 'implement',
  apply_patch: 'implement',
  create: 'implement',
  create_file: 'implement',
  shell: 'implement',
  bash: 'implement',
  execute: 'implement',
  run: 'implement',
  mcp__: 'implement',
  todowrite: 'plan',
  todo_write: 'plan',
  plan: 'plan',
  reasoning: 'plan',
  think: 'plan',
  test: 'verify',
  run_tests: 'verify',
  npm_test: 'verify',
  submit: 'report',
  finish_work: 'report',
  task_done: 'report',
  complete: 'report',
  debug: 'debug',
  inspect: 'debug',
  console: 'debug',
};

type Certainty = 'explicit' | 'meta' | 'propagate';

function certaintyOf(event: TraceEvent): Certainty {
  switch (event.kind) {
    case 'system':
      return 'meta';
    case 'tool':
    case 'file_read':
    case 'file_write':
    case 'bash':
    case 'test':
      return 'explicit';
    default:
      return 'propagate';
  }
}

function explicitPhaseOf(event: TraceEvent): TracePhase | null {
  switch (event.kind) {
    case 'test':
      return 'verify';
    case 'bash': {
      const cls = classifyBashCommand(event.title);
      if (cls === 'other') {
        return 'implement';
      }
      return cls === 'report' ? 'report' : cls;
    }
    case 'file_read':
      return 'understand';
    case 'file_write':
      return 'implement';
    case 'tool': {
      const action = (event.tool ?? event.title ?? '').toLowerCase();
      for (const [name, phase] of Object.entries(ACTION_PHASE)) {
        if (action.startsWith(name)) {
          return phase;
        }
      }
      return 'implement';
    }
    default:
      return null;
  }
}

function isErrorLike(event: TraceEvent): boolean {
  return event.status === 'error' || event.status === 'cancelled';
}

const DEFAULT_PHASE: Partial<Record<TraceEvent['kind'], TracePhase>> = {
  user_prompt: 'understand',
  message: 'understand',
  subagent_prompt: 'understand',
  system: 'understand',
  llm: 'implement',
  agent: 'implement',
};

/**
 * REQ-001：两遍分类。输入保持原顺序，返回带 phase 的新数组。
 * - bash 测试命令 → verify
 * - 错误后写文件 → debug（覆盖 implement）
 */
export function classifyEvents(events: TraceEvent[]): TraceEvent[] {
  const explicitIndexes: number[] = [];
  const pass1 = events.map((event, index) => {
    const certainty = certaintyOf(event);
    if (certainty === 'explicit') {
      explicitIndexes.push(index);
    }
    return { event, certainty };
  });

  const result = events.map((event, index) => {
    if (certaintyOf(event) === 'explicit') {
      let phase = explicitPhaseOf(event);
      // 错误后写文件 → debug（REQ-001 Scenario）
      if (
        phase === 'implement' &&
        (event.kind === 'file_write' || event.kind === 'tool') &&
        index > 0 &&
        (events[index - 1]?.kind === 'bash' || events[index - 1]?.kind === 'test') &&
        isErrorLike(events[index - 1]!)
      ) {
        phase = 'debug';
      }
      return { ...event, phase: phase ?? DEFAULT_PHASE[event.kind] ?? 'implement' };
    }
    return event;
  });

  // Pass 2：propagate / meta 继承最近 explicit
  for (let i = 0; i < result.length; i += 1) {
    const certainty = pass1[i]!.certainty;
    if (certainty === 'explicit') {
      continue;
    }
    let before: number | null = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (pass1[j]!.certainty === 'explicit') {
        before = j;
        break;
      }
    }
    let after: number | null = null;
    for (let j = i + 1; j < result.length; j += 1) {
      if (pass1[j]!.certainty === 'explicit') {
        after = j;
        break;
      }
    }
    let phase: TracePhase;
    if (before === null && after === null) {
      phase = DEFAULT_PHASE[result[i]!.kind] ?? 'implement';
    } else if (before === null) {
      phase = result[after!]!.phase;
    } else if (after === null) {
      phase = result[before]!.phase;
    } else {
      const beforeDist = i - before;
      const afterDist = after - i;
      if (beforeDist < afterDist) {
        phase = result[before]!.phase;
      } else if (afterDist < beforeDist) {
        phase = result[after]!.phase;
      } else if (result[i]!.kind === 'llm') {
        phase = result[before]!.phase; // LLM 偏前
      } else {
        phase = result[after]!.phase; // agent / message 偏后
      }
    }
    result[i] = { ...result[i]!, phase };
  }
  return result;
}
