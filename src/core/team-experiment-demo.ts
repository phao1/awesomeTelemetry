import { EMPTY_QUALITY } from './benchmark-types.js';
import type { BenchmarkSpan } from './benchmark-types.js';
import type { TeamExperimentEvent, TeamExperimentEvidence, TeamExperimentPlan, TeamExperimentReport, TeamExperimentScenario, TeamExperimentTrial } from './team-experiment-types.js';
import { teamExperimentPromptSha256 } from './team-experiment-validation.js';

const cases = ['happy-path', 'pagination', 'permissions', 'invalid-input', 'concurrency', 'regression'];
export const TEAM_EXPERIMENT_TEMPLATE: TeamExperimentPlan = {
  version: 1, kind: 'team-experiment', name: '同任务：单 loop / 主子 Agent / Agent Team', repetitions: 3, schedule: 'parallel',
  task: { id: 'user-filter-api', repository: '/absolute/path/to/task-repository', ref: 'HEAD', prompt: '实现用户筛选 API：支持分页、权限及非法输入处理，保留现有行为并通过固定验收。', expectedTests: 6, caseIds: cases, evaluator: ['/absolute/path/to/independent-evaluator'], timeoutMs: 300000 },
  variants: [
    { id: 'single', mode: 'single_loop', prompt: '独立在同一个 Agent 循环中完成用户筛选 API。按需读取规则和工具，先实现再验收；不要委派子 Agent。', product: 'configured-coding-agent', model: 'set-exact-model-id', environment: 'fixed-local-environment', parameters: 'fixed-effort-and-budget', toolSet: 'fixed-repository-tools', driver: ['/absolute/path/to/single-loop-driver'] },
    { id: 'subagents', mode: 'subagents', prompt: '完成用户筛选 API。主 Agent 负责接口和整合，将独立的权限检查与边界验证交给两个子 Agent；要求返回证据与紧凑结论，由主 Agent 统一验收。', product: 'configured-coding-agent', model: 'set-exact-model-id', environment: 'fixed-local-environment', parameters: 'fixed-effort-and-budget', toolSet: 'fixed-repository-tools', driver: ['/absolute/path/to/subagent-driver'] },
    { id: 'team', mode: 'agent_team', prompt: '用 Agent Team 完成用户筛选 API。共享验收任务，由接口和验证成员独立工作；遇到权限、分页与并发假设冲突时直接交流证据，主 Agent 整合后运行固定验收。', product: 'configured-coding-agent', model: 'set-exact-model-id', environment: 'fixed-local-environment', parameters: 'fixed-effort-and-budget', toolSet: 'fixed-repository-tools', driver: ['/absolute/path/to/team-driver'] },
  ],
};

function evidenceFor(mode: string, duration: number, failed: boolean, extraRework: boolean): TeamExperimentEvidence {
  const multi = mode !== 'single_loop', team = mode === 'agent_team';
  const agents = [{ id: 'lead', name: '主 Agent', parentId: null, sessionKey: null }, ...(multi ? [{ id: 'api', name: '接口实现', parentId: 'lead', sessionKey: null }, { id: 'verify', name: '权限与边界验证', parentId: 'lead', sessionKey: null }] : [])];
  const events: TeamExperimentEvent[] = [];
  const add = (id: string, agentId: string, kind: TeamExperimentEvent['kind'], start: number, span: number | null, name: string, detail: string, dependsOn: string[] = [], targetAgentId: string | null = null, status: TeamExperimentEvent['status'] = 'ok', tokens: number | null = null) => events.push({ id, agentId, targetAgentId, kind, name, detail, startMs: Math.round(start * duration), durationMs: span === null ? null : Math.round(span * duration), timing: 'measured', status, dependsOn, tokens, sessionKey: null, eventId: null });
  add('context-lead', 'lead', 'context', 0, 0, '读取任务与固定验收约束', '模拟上下文记录：原任务要求分页、权限、错误返回与兼容性。验收脚本在工作区外，Agent 不能通过改写测试取得通过。此 Token 计数是诊断字段，不再加到 usage。', [], null, 'ok', 8000);
  add('plan', 'lead', 'model', .01, .1, '制定实现与验证计划', '公开输出：先核对现有筛选参数和权限入口，再实现分页。验收需要同时覆盖越权、非法输入、重复翻页以及并发请求，不把工具退出成功等同于任务验收。', ['context-lead']);
  if (!multi) {
    add('inspect', 'lead', 'tool', .12, .07, '读取接口与现有测试', '参数：{"command":"read src/users.ts tests/users.test.ts"}\n结果：现接口仅接受 name；鉴权中间件已存在。默认 limit=20，旧调用不携带分页参数。', ['plan']);
    add('implement', 'lead', 'model', .21, .25, '实现参数校验与分页', '公开输出：复用既有鉴权检查。limit 必须为1..100整数；offset非负；不把空字符串转换为0。数据与总数使用同一过滤条件，维持默认响应字段。', ['inspect']);
    add('edit', 'lead', 'tool', .48, .08, '保存接口实现', '参数：{"path":"src/users.ts","operation":"patch"}\n结果：新增参数验证与稳定分页排序。未修改验收脚本。', ['implement']);
    add('verify', 'lead', 'verification', .58, .1, '运行固定验收', failed ? '独立验收：分页和权限通过；并发请求发生游标共享，concurrency失败。需要隔离每次请求的查询状态。' : '独立验收：happy-path、pagination、permissions、invalid-input、concurrency、regression全部通过。', ['edit'], null, failed ? 'error' : 'ok');
    if (failed) add('rework', 'lead', 'rework', .7, .13, '复查并发状态污染', '公开返工记录：定位共享游标，提出把查询状态移到请求作用域。当前模拟运行尚未完成修复，失败验收不会被摘要覆盖。', ['verify']);
  } else {
    add('assign-api', 'lead', 'task', .12, .015, '分派接口实现', '任务边界：只改用户筛选实现；保留默认响应兼容性；返回修改位置与验证证据。', ['plan'], 'api');
    add('assign-verify', 'lead', 'task', .135, .015, '分派权限与边界验证', '任务边界：独立检视越权、非法输入和并发；不修改外部验收器；发现问题给出复现输入。', ['plan'], 'verify');
    add('context-api', 'api', 'context', .15, 0, '加载接口成员上下文', '模拟上下文：工作区快照、任务说明、接口契约和允许工具。主会话历史不会自动视为成员可见。', ['assign-api'], null, 'ok', 6000);
    add('context-verify', 'verify', 'context', .15, 0, '加载验证成员上下文', '模拟上下文：固定验收项、鉴权入口和只读检查范围。与接口成员通过任务ID关联。', ['assign-verify'], null, 'ok', 5000);
    add('api-work', 'api', 'model', .17, .28, '实现筛选、排序和分页', '公开输出：把过滤条件放入请求作用域，稳定排序按createdAt和id。默认limit=20；越权用户在读取数据前拒绝。将兼容字段纳入本次实现。', ['context-api']);
    add('verify-work', 'verify', 'tool', .17, .22, '检视权限与并发边界', '参数：{"cases":["permissions","invalid-input","concurrency"]}\n结果：构造两个用户同时翻页的请求；空limit必须报参数错误。接口和验证成员的工作确实重叠，但累计活动时长不等于加速比。', ['context-verify']);
    if (team) {
      add('peer-question', 'verify', 'message', .4, .01, '向接口成员质疑并发假设', '收件人：接口实现\n问题：查询游标是否被模块变量共享？复现：用户A offset=20与用户B offset=0并发时，B读到了A的下一页。请说明隔离策略。', ['verify-work'], 'api');
      add('peer-reply', 'api', 'message', .46, .01, '返回隔离策略与修复位置', '收件人：权限与边界验证\n答复：已将游标从模块变量移入每次请求，补充稳定排序。请用两个并发客户端重复验证；文件 src/users.ts，函数 queryUsers。', ['api-work', 'peer-question'], 'verify');
      add('peer-check', 'verify', 'verification', .49, .12, '复验成员间提出的反例', '参数：{"concurrentClients":2,"repetitions":10}\n结果：模拟反例复验通过。这是记录到的协作结果，不由消息数量推断质量收益；最后仍以外部具名验收为准。', ['peer-reply']);
    }
    add('lead-wait', 'lead', 'wait', .16, .38, '等待成员结果', '运行器显式记录：主 Agent 正在等待两个已分派任务的结果。该等待区间不是从日志空白推算。', ['assign-api', 'assign-verify']);
    add('lead-wait-overlap', 'lead', 'wait', .3, .2, '同一等待中的第二个依赖', '显式等待验证成员。统计对同一Agent内重叠等待取并集，避免重复计时。', ['assign-verify']);
    add('return-api', 'api', 'handoff', .62, .01, '交回接口结果', '结果摘要：分页实现及请求内查询状态已保存；原始文件与测试输出在当前独立工作区。待主 Agent 统一验收。', ['api-work'], 'lead');
    add('return-verify', 'verify', 'handoff', .64, .01, '交回验证结果', '结果摘要：已检查参数和权限边界；并发反例及验证记录附在输出中。不能把该摘要当作外部验收报告。', team ? ['peer-check'] : ['verify-work'], 'lead');
    add('integrate', 'lead', 'model', .67, .09, '整合成员证据与改动', '公开输出：核对两个成员的边界和结果，检查未覆盖的兼容行为，统一运行外部固定验收。成员工作不能各自通过就宣称整体通过。', ['return-api', 'return-verify']);
    if (extraRework) add('rework', 'lead', 'rework', .77, .08, '消除成员接口假设差异', '显式返工：验证成员按page/pageSize调用，但接口实现使用offset/limit。主 Agent 对齐任务约束，修改适配层后重新验收；记录该协调代价。', ['integrate']);
    add('verify', 'lead', 'verification', .86, .06, '运行独立具名验收', failed ? '外部验收未全通过：concurrency或regression失败。成员声明完成不覆盖失败结果。' : '外部固定6项验收全部通过；任务结果包含接口行为、权限、并发与兼容性。', extraRework ? ['rework'] : ['integrate'], null, failed ? 'error' : 'ok');
  }
  add('artifact', 'lead', 'artifact', .95, .025, '保存任务产物与验收证据', '模拟产物：src/users.ts补丁、固定验收JSON、运行时间与Token记录。重放只展示已有事件，不执行工具。所有数据均为合成示例，不代表真实厂商模型能力。', ['verify']);
  return { coverage: { roster: true, activities: true, communication: true }, agents, events };
}

/** Four deterministic, fully labelled synthetic scenarios; no model, network or tool execution. */
export function createTeamExperimentDemo(scenario: TeamExperimentScenario): TeamExperimentReport {
  const plan: TeamExperimentPlan = { ...TEAM_EXPERIMENT_TEMPLATE, name: `模拟 · ${scenario}`, task: { ...TEAM_EXPERIMENT_TEMPLATE.task, caseIds: [...cases] }, variants: TEAM_EXPERIMENT_TEMPLATE.variants.map(v => ({ ...v, model: 'synthetic-model', environment: 'synthetic-isolated-host', driver: ['synthetic-no-execution'] })) };
  const times = scenario === 'single_wins' ? [60000, 88000, 104000] : scenario === 'subagents_win' ? [100000, 55000, 75000] : [70000, 64000, 78000];
  const tokenTotals = scenario === 'single_wins' ? [16000, 26000, 35000] : scenario === 'subagents_win' ? [32000, 23000, 33000] : [21000, 26000, 34000];
  const trials: TeamExperimentTrial[] = plan.variants.flatMap((variant, index) => [1, 2, 3].map(repetition => {
    const factor = [1, 1.03, .98][repetition - 1]!, e2eMs = Math.round(times[index]! * factor);
    const failed = scenario === 'team_quality' && index < 2;
    const verdicts = cases.map(id => ({ id, status: failed && id === (index === 0 ? 'concurrency' : 'regression') ? 'failed' as const : 'passed' as const, detail: failed && id === (index === 0 ? 'concurrency' : 'regression') ? '模拟独立验收捕获行为回归。' : '模拟独立验收通过。' }));
    const evidence = evidenceFor(variant.mode, e2eMs, failed, scenario === 'single_wins' && index > 0);
    const spans: BenchmarkSpan[] = evidence.events.filter(e => e.kind === 'model' || e.kind === 'tool').map(e => ({ id: e.id, kind: e.kind as 'model' | 'tool', name: e.name, startMs: e.startMs + 500, durationMs: e.durationMs, timing: 'measured', status: e.status, firstTokenMs: e.kind === 'model' ? 600 : null, outputTokens: e.kind === 'model' ? 1200 : null, sessionKey: null, eventId: null }));
    const tokens = tokenTotals[index]!;
    const trial: TeamExperimentTrial = { id: `${variant.id}-${repetition}`, variantId: variant.id, repetition, promptSha256: teamExperimentPromptSha256(variant.prompt), cases: verdicts, evidence, evidenceError: null,
      run: { id: `${variant.id}-${repetition}`, variantId: variant.id, repetition, startedAt: `2026-10-29T00:0${repetition}:00.000Z`, status: 'completed', host: 'synthetic-host', e2eMs, error: null,
        telemetry: { actualModel: 'synthetic-model', sessionKey: null, complete: true, usage: { input: tokens - 3000, output: 3000, reasoning: 1000, cacheRead: Math.round((tokens - 3000) * .6), cacheWrite: 0, inputIncludesCache: true, outputIncludesReasoning: true }, spans },
        verdict: { passed: verdicts.filter(c => c.status === 'passed').length, total: cases.length, quality: { ...EMPTY_QUALITY, loc: 180, vulnerabilities: 0, duplicationPct: 2, complexity: 3, buildWarnings: 0 } },
        phases: [{ id: 'prepare', kind: 'runner', name: 'prepare', startMs: 0, durationMs: 500, timing: 'measured', status: 'ok', firstTokenMs: null, outputTokens: null, sessionKey: null, eventId: null }, { id: 'evaluate', kind: 'runner', name: 'evaluate', startMs: e2eMs + 500, durationMs: 200, timing: 'measured', status: failed ? 'error' : 'ok', firstTokenMs: null, outputTokens: null, sessionKey: null, eventId: null }] } };
    if (scenario === 'incomplete' && index > 0) { trial.evidence!.coverage.communication = false; trial.run.telemetry!.complete = false; trial.cases = null; trial.evidenceError = 'Synthetic missing collaboration capture and named acceptance'; }
    return trial;
  }));
  return { version: 1, kind: 'team-experiment-report', synthetic: true, plan, commit: '0'.repeat(40), createdAt: '2026-10-29T00:00:00.000Z', trials };
}
