import type { TraceEvent, TracePhase } from './trace-types.js';

/**
 * REQ-001（metrics-analysis）：Phase 两遍分类算法。
 * Pass 1：explicit（action 直接映射）/ meta（system）/ propagate（message、reasoning、function_call、llm、agent）
 * Pass 2：propagate 与 meta 继承最近 explicit 的 phase；前后取近者，LLM 偏前，agent 与 message 偏后。
 */

// `npm run test` / `pnpm test` / `yarn test:unit` 是最常见的跑测方式，
// 只匹配字面量 `npm test` 会把绝大多数验证行为漏判成 implement。
//
// 2026-08-11：此前整张表只覆盖 JS/Python/Go/Rust 工具链，Java 项目一个都命中不了 ——
// 实测 CodeArts 在若依（Maven）项目里跑的 `mvn compile` / `mvn clean install` 全部
// 落到 implement，verify 阶段颗粒无收，连带 verificationPresent / verificationCoverage
// 恒为 0。JVM 侧按**目标**判定而不是按 `mvn` 二进制名判定，因为 `mvn spring-boot:run`
// 是「把服务跑起来」不是「验证」，必须留在 implement。
const JVM_VERIFY_CMD = /\b(mvn|mvnw|gradle|gradlew)\b[^\n;|&]*\b(compile|test|verify|install|package|check|build|assemble)\b/;
const VERIFY_CMD = new RegExp(
  '((npm|pnpm|yarn|bun)( run)? (test|typecheck|lint)' +
    '|vitest|jest|pytest|cargo test|go test|tsc|eslint|playwright test' +
    '|dotnet (test|build)|\\bctest\\b|\\brspec\\b|\\bphpunit\\b|make (test|check|lint))' +
    `|${JVM_VERIFY_CMD.source}`,
);
const REPORT_CMD = /(^|\s)(git commit|git push|gh pr|git pr|gh issue)/;
const UNDERSTAND_CMD = /(^|\s)(cat|ls|find|grep|rg|head|tail|less|more|jq|stat)/;
const IMPLEMENT_CMD = /(^|\s)(rm|cp|mv|mkdir|touch|git add|sed|awk|echo)/;

export type BashCommandClass =
  | 'verify'
  | 'report'
  | 'understand'
  | 'implement'
  | 'other';

/**
 * 取出事件真正执行的 shell 命令文本。
 *
 * 别用 `event.title`：多数 adapter 的 title 是模型给的**人类描述**，不是命令。
 * 实测 CodeArts 的 bash 事件 title = "Compile project to verify changes"，
 * 真正的 `mvn compile …` 藏在 inputSummary 的 `{"command":…,"description":…}` 里 ——
 * 只看 title 会把每一条构建/跑测命令都误判成 implement。
 *
 * inputSummary 不是 JSON（Claude/Codex 直接放命令字符串）时原样返回；
 * 两者都没有时才退回 title。
 */
export function commandTextOf(event: {
  inputSummary?: string | null;
  title?: string | null;
}): string {
  const raw = event.inputSummary ?? '';
  const command = raw.trim().startsWith('{') ? parsedCommandField(raw) : null;
  if (command !== null) {
    return command;
  }
  return raw !== '' ? raw : event.title ?? '';
}

/**
 * 从 `{"command":…,"description":…}` 里取 command。
 * 解析失败返回 null —— inputSummary 常被截断成半截 JSON，调用方退回原串即可，
 * 正则照样能在里面匹配到命令子串，所以这里**不需要**也不应该报错。
 */
function parsedCommandField(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const command = (parsed as { command?: unknown }).command;
  return typeof command === 'string' && command !== '' ? command : null;
}

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

/**
 * 执行 shell 的工具：真正决定阶段的是**命令内容**，不是工具名。
 *
 * 实测数据里 `npm test` 一律通过 Claude 的 `Bash` 或 Codex 的 `exec_command`
 * 发出，命令本身在 inputSummary 里。此前只按工具名查表，这些全部落到
 * 'implement'，导致全库 33,046 个事件里 verify 阶段 **一个都没有**，
 * 「准 / 验证覆盖 / 调试率」三个指标恒为 0。
 */
const SHELL_TOOLS = new Set([
  'bash',
  'shell',
  'exec_command',
  'execute_command',
  'run_command',
  'run_terminal_cmd',
  'terminal',
  'local_shell',
]);

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
  update_plan: 'plan',
  taskcreate: 'plan',
  taskupdate: 'plan',
  tasklist: 'plan',
  exitplanmode: 'plan',
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

/**
 * 用户把异常栈贴回来 —— 这是返工开始的最强信号，也是**真实调试轮次的绝大多数**。
 *
 * 原先 debug 只在「bash 失败后紧接着写文件」时触发，而智能体自己跑的命令往往
 * 退出码为 0（服务起来了，报错在 HTTP 响应里），失败是用户手动测出来再贴回来的。
 * 结果 enteredDebug / durationByPhase.debug 在真实数据里恒为 0。
 *
 * 判定刻意保守：只认**异常类名**（NoSuchMethodError / SQLSyntaxErrorException）、
 * Python traceback 头、以及 `at com.foo.Bar(Baz.java:42)` 形式的栈帧。
 * 不认裸词 "error"/"错误" —— 那会把「这里有个错别字」也判成调试。
 * Exception/Error 后缀区分大小写，避免命中普通英文散文。
 */
const ERROR_REPORT =
  /\b\w+(Exception|Error)\b|Traceback \(most recent call last\)|\bat [\w.$]+\([^\s)]*:\d+\)/;

/** 用户消息是否在报错（贴异常栈 / traceback）。 */
export function isErrorReportPrompt(text: string): boolean {
  return ERROR_REPORT.test(text);
}

/**
 * 取用户消息的判定文本。title 会被 adapter 截到 ~100 字符，异常类名常常正好
 * 落在截断之外，所以优先用 inputSummary（完整正文）。
 */
export function promptTextOf(event: {
  inputSummary?: string | null;
  title?: string | null;
}): string {
  return event.inputSummary ?? event.title ?? '';
}

type Certainty = 'explicit' | 'meta' | 'propagate';

/**
 * fix-adapter-turn-semantics A8：新增两个 kind 后，switch 必须**穷举**全部
 * TraceKind 成员，禁止引入 default 兜底来压过编译器（trace-model delta 的
 * "Exhaustive handling" 场景）。
 * - compact：上下文恢复，是明确的 understand 活动（explicit）。
 * - reasoning：不是独立活动，走 propagate，在 Pass 3 继承同周期 llm 的阶段。
 */
function certaintyOf(event: TraceEvent): Certainty {
  // 贴了异常栈的用户消息是 debug 的显式锚点（见 ERROR_REPORT）：它必须能被
  // 后续 propagate 事件继承，所以不能停留在 propagate。
  if (event.kind === 'user_prompt' && isErrorReportPrompt(promptTextOf(event))) {
    return 'explicit';
  }
  switch (event.kind) {
    case 'tool':
    case 'file_read':
    case 'file_write':
    case 'bash':
    case 'test':
    case 'compact':
      return 'explicit';
    case 'system':
      return 'meta';
    case 'llm':
    case 'agent':
    case 'message':
    case 'user_prompt':
    case 'subagent_prompt':
    case 'reasoning':
      return 'propagate';
  }
}

function explicitPhaseOf(event: TraceEvent): TracePhase | null {
  // certaintyOf 只把「贴了异常栈」的 user_prompt 判为 explicit，走到这里必然是它。
  if (event.kind === 'user_prompt') {
    return 'debug';
  }
  switch (event.kind) {
    case 'test':
      return 'verify';
    case 'bash': {
      // 与下方 SHELL_TOOLS 分支同口径：判定依据是命令文本，不是 title。
      const cls = classifyBashCommand(commandTextOf(event));
      if (cls === 'other') {
        return 'implement';
      }
      return cls === 'report' ? 'report' : cls;
    }
    case 'file_read':
      return 'understand';
    case 'file_write':
      return 'implement';
    case 'compact':
      // fix-adapter-turn-semantics A8：compact 归 understand（上下文恢复）。
      return 'understand';
    case 'tool': {
      const action = (event.tool ?? event.title ?? '').toLowerCase();
      // 跑 shell 的工具按命令内容判定（npm test → verify、git commit → report…），
      // 只看工具名会把所有命令都判成 implement。
      if (SHELL_TOOLS.has(action)) {
        const cls = classifyBashCommand(commandTextOf(event));
        return cls === 'other' ? 'implement' : cls;
      }
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
  // fix-adapter-turn-semantics A8：reasoning 默认与 llm 一致；
  // 有同周期 llm 时由 Pass 3 覆盖为 llm 的阶段。
  reasoning: 'implement',
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

  // Pass 3（fix-adapter-turn-semantics A8）：reasoning 不是独立活动，
  // 继承同一决策周期（turnKey）内 llm 事件的阶段。周期内无 llm、
  // 或 turnKey 为 null（源格式无边界信号）时，保留 Pass 2 的传播结果。
  const llmPhaseByTurnKey = new Map<string, TracePhase>();
  for (const event of result) {
    if (event.kind === 'llm' && event.turnKey !== null) {
      if (!llmPhaseByTurnKey.has(event.turnKey)) {
        llmPhaseByTurnKey.set(event.turnKey, event.phase);
      }
    }
  }
  if (llmPhaseByTurnKey.size > 0) {
    for (let i = 0; i < result.length; i += 1) {
      const event = result[i]!;
      if (event.kind === 'reasoning' && event.turnKey !== null) {
        const cyclePhase = llmPhaseByTurnKey.get(event.turnKey);
        if (cyclePhase !== undefined) {
          result[i] = { ...event, phase: cyclePhase };
        }
      }
    }
  }
  return result;
}
