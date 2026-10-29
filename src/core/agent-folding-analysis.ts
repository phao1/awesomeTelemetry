import type {
  FoldingAnalysis, FoldingBoundaryDecision, FoldingEstimate, FoldingExperiment,
  FoldingExperimentAnalysis, FoldingJson, FoldingMetricSummary, FoldingPair, FoldingProject, FoldingRunPlan, FoldingText, FoldingTrial,
} from './agent-folding-types.js';
import { FOLDING_MAX_BYTES, validateFoldingProject, validateFoldingRunPlan } from './agent-folding-validation.js';

const text = (zh: string, en: string): FoldingText => ({ zh, en });
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const refs = (items: Array<string | null>): string[] => unique(items.filter((item): item is string => item !== null)).slice(0, 32);
const realKinds = new Set(['official_recording', 'live_api']);
function canonical(value: FoldingJson): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
function route(trial: FoldingTrial | undefined): string[] {
  if (!trial) return [];
  const result: string[] = [];
  for (const event of [...trial.events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.agentId !== null && result[result.length - 1] !== event.agentId) result.push(event.agentId);
  }
  return result;
}
function steps(trial: FoldingTrial): string[] {
  return [...trial.events].sort((a, b) => a.sequence - b.sequence).flatMap(event => [event.agentId, event.name].filter((value): value is string => value !== null));
}
function ordered(chain: string[], actual: string[]): boolean {
  let position = 0;
  for (const item of actual) if (chain[position] === item) position += 1;
  return position === chain.length;
}
function summary(values: number[]): FoldingMetricSummary {
  if (!values.length) return { n: 0, mean: null, median: null };
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return { n: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2 };
}
function grade(trial: FoldingTrial | undefined, project: FoldingProject): 0 | 1 | null {
  if (!trial || trial.harnessError !== null) return null;
  const source = project.sources.find(source => source.id === trial.sourceId);
  return source && ['official_recording', 'live_api', 'user_import'].includes(source.kind) ? trial.grade : null;
}
function outcome(before: 0 | 1 | null, after: 0 | 1 | null): FoldingPair['outcome'] {
  return before === null || after === null ? 'unknown' : before === 1 && after === 0 ? 'regression'
    : before === 0 && after === 1 ? 'improvement' : before === 1 ? 'both_passed' : 'both_failed';
}

function analyzeExperiment(project: FoldingProject, experiment: FoldingExperiment): FoldingExperimentAnalysis {
  const selected = project.trials.filter(trial => trial.experimentId === experiment.id && experiment.trialIds.includes(trial.id));
  const trialMap = new Map(selected.map(trial => [JSON.stringify([trial.variantId, trial.caseId, trial.repetition]), trial]));
  const evidence = new Map(project.evidence.map(item => [item.id, item]));
  const sources = new Map(project.sources.map(item => [item.id, item]));
  const cases = experiment.caseIds.map(id => project.cases.find(c => c.id === id)!);
  const repetitionsFor = (caseId: string): number[] => unique([
    ...Array.from({ length: experiment.expectedRepetitions }, (_, index) => index),
    ...selected.filter(trial => trial.caseId === caseId).map(trial => trial.repetition),
  ]).sort((a, b) => a - b);
  const blockers: FoldingText[] = [];
  const observations: FoldingExperimentAnalysis['observations'] = [];
  const block = (zh: string, en: string) => { if (!blockers.some(item => item.en === en)) blockers.push(text(zh, en)); };
  const pairs: FoldingPair[] = [];
  const actionsComplete = (trial: FoldingTrial | undefined): boolean => {
    if (!trial) return false;
    const completeSource = (id: string | null) => {
      const source = id === null ? undefined : evidence.get(id);
      return source?.complete === true && source.sourceId === trial.sourceId;
    };
    // Published complete grade rows include actions. A partial tool preview must
    // not erase the full action record retained alongside that preview.
    if (trial.evidenceIds.some(id => evidence.get(id)?.kind === 'grade' && completeSource(id))) return true;
    if (trial.actions.length > 0) return trial.actions.every(action => completeSource(action.evidenceId));
    return trial.evidenceIds.some(id => {
      const source = evidence.get(id); return source?.kind === 'trace' && source.pointer === null && completeSource(id);
    });
  };
  for (const c of cases) for (const repetition of repetitionsFor(c.id)) {
    const before = trialMap.get(JSON.stringify([experiment.baselineVariantId, c.id, repetition]));
    const after = trialMap.get(JSON.stringify([experiment.candidateVariantId, c.id, repetition]));
    const baselineGrade = grade(before, project), candidateGrade = grade(after, project);
    const actionsChanged = actionsComplete(before) && actionsComplete(after) && before && after
      ? canonical(before.actions.map(action => ({ name: action.name, args: action.args })))
        !== canonical(after.actions.map(action => ({ name: action.name, args: action.args }))) : null;
    pairs.push({ caseId: c.id, repetition, baselineTrialId: before?.id ?? null, candidateTrialId: after?.id ?? null,
      baselineGrade, candidateGrade, outcome: outcome(baselineGrade, candidateGrade), routeBefore: route(before), routeAfter: route(after), actionsChanged,
      evidenceIds: refs([...(before?.evidenceIds ?? []), ...(after?.evidenceIds ?? []),
        ...(before?.actions.map(action => action.evidenceId) ?? []), ...(after?.actions.map(action => action.evidenceId) ?? [])]) });
  }
  const score = (side: 'baselineGrade' | 'candidateGrade') => {
    const known = pairs.filter(pair => pair[side] !== null).length, passed = pairs.filter(pair => pair[side] === 1).length;
    const expected = pairs.length;
    // A missing outcome remains unknown, never a failed assertion or an extra case.
    const taskMeans = cases.map(c => {
      const taskPairs = pairs.filter(pair => pair.caseId === c.id);
      return taskPairs.every(pair => pair[side] !== null) ? taskPairs.reduce((sum, pair) => sum + pair[side]!, 0) / taskPairs.length : null;
    });
    const taskScore = expected > 0 && taskMeans.every(value => value !== null)
      ? taskMeans.reduce<number>((sum, value) => sum + value!, 0) / taskMeans.length : null;
    // Bounded task-level Hoeffding interval (95%, assuming independent task inputs).
    const radius = taskScore === null ? null : Math.sqrt(Math.log(40) / (2 * taskMeans.length));
    const interval: [number, number] | null = taskScore === null || radius === null ? null
      : [Math.max(0, taskScore - radius) * 100, Math.min(1, taskScore + radius) * 100];
    return { passed, known, expected, taskScore: taskScore === null ? null : taskScore * 100, interval };
  };
  const baseline = score('baselineGrade'), candidate = score('candidateGrade');
  let ablation: FoldingExperimentAnalysis['ablation'];
  if (experiment.ablationVariantId !== undefined) {
    const records = pairs.map(pair => ({ pair, trial: trialMap.get(JSON.stringify([experiment.ablationVariantId, pair.caseId, pair.repetition])) }));
    const known = records.filter(record => grade(record.trial, project) !== null).length;
    const passed = records.filter(record => grade(record.trial, project) === 1).length;
    const taskMeans = cases.map(c => {
      const rows = records.filter(record => record.pair.caseId === c.id);
      return rows.every(record => grade(record.trial, project) !== null)
        ? rows.reduce((sum, record) => sum + grade(record.trial, project)!, 0) / rows.length : null;
    });
    ablation = { variantId: experiment.ablationVariantId, passed, known, expected: pairs.length,
      taskScore: taskMeans.every(value => value !== null) ? taskMeans.reduce<number>((sum, value) => sum + value!, 0) / taskMeans.length * 100 : null,
      regressions: records.filter(record => record.pair.candidateGrade === 1 && grade(record.trial, project) === 0).length,
      evidenceIds: refs(records.flatMap(record => record.trial?.evidenceIds ?? [])) };
    observations.push({ title: text('独立的 skill-off 消融结果', 'Separate skill-off ablation'),
      detail: text(`关闭技能组通过 ${passed}/${pairs.length}，已知 ${known}；相对完整候选的 ${ablation.regressions} 次通过变失败仅是消融差异，不是折叠本体回归。`,
        `The skill-off variant passed ${passed}/${pairs.length}, with ${known} known outcomes. Its ${ablation.regressions} pass-to-fail changes relative to the full candidate are ablation differences, not regressions of the folding intervention.`),
      evidenceIds: ablation.evidenceIds });
  }
  const metricKeys = ['latencyMs', 'inputTokens', 'outputTokens', 'modelCalls', 'toolCalls'] as const;
  const metrics = Object.fromEntries(metricKeys.map(key => {
    const matched = pairs.filter(pair => pair.baselineTrialId !== null && pair.candidateTrialId !== null)
      .map(pair => [selected.find(trial => trial.id === pair.baselineTrialId)!, selected.find(trial => trial.id === pair.candidateTrialId)!] as const)
      .filter(([before, after]) => before.harnessError === null && after.harnessError === null && before[key] !== null && after[key] !== null);
    return [key, { baseline: summary(matched.map(([before]) => before[key]!)), candidate: summary(matched.map(([, after]) => after[key]!)) }];
  })) as FoldingExperimentAnalysis['metrics'];
  const coverage: FoldingExperimentAnalysis['coverage'] = [];
  for (const variantId of [experiment.baselineVariantId, experiment.candidateVariantId]) {
    const chains = unique(cases.flatMap(c => c.requiredChains.map(chain => JSON.stringify(chain))));
    for (const chainKey of chains) {
      const chain = JSON.parse(chainKey) as string[];
      const relevant = cases.filter(c => c.requiredChains.some(required => JSON.stringify(required) === chainKey));
      let trialsSeen = 0, trialsSuccessful = 0;
      const evidenceIds: string[] = [];
      for (const c of relevant) for (const repetition of repetitionsFor(c.id)) {
        const trial = trialMap.get(JSON.stringify([variantId, c.id, repetition]));
        if (!trial) continue;
        const mapping = experiment.chainMappings?.find(mapping => mapping.variantId === variantId && mapping.verified
          && JSON.stringify(mapping.before) === chainKey && mapping.evidenceIds.length > 0 && mapping.evidenceIds.every(id => {
            const source = evidence.get(id); return source?.complete && ['official_recording', 'live_api', 'source_code'].includes(sources.get(source.sourceId)?.kind ?? '');
          }));
        const present = ordered(mapping?.after ?? chain, steps(trial));
        if (present) { trialsSeen += 1; evidenceIds.push(...trial.events.map(event => event.evidenceId), ...(mapping?.evidenceIds ?? [])); }
        const terminal = c.chainChecks?.find(item => JSON.stringify(item.chain) === chainKey);
        const terminalResult = terminal ? trial.checks.find(check => check.id === terminal.checkId) : undefined;
        const successful = present && trial.events.length > 0 && trial.events.every(event => event.complete)
          && grade(trial, project) === 1 && terminalResult?.passed === true && trial.harnessError === null;
        if (successful) { trialsSuccessful += 1; if (terminalResult.evidenceId !== null) evidenceIds.push(terminalResult.evidenceId); }
        if (variantId === experiment.candidateVariantId && !successful) block('候选方案没有在每个重复中完成所有相关有序链及其终端检查。',
          'The candidate has not completed every relevant ordered chain and terminal check in each repetition.');
      }
      coverage.push({ variantId, chain, trialsSeen, trialsSuccessful, caseIds: relevant.map(c => c.id), evidenceIds: refs(evidenceIds) });
    }
  }
  const regressions = pairs.filter(pair => pair.outcome === 'regression'), improvements = pairs.filter(pair => pair.outcome === 'improvement');
  if (regressions.length) block('至少一个任务从通过变为失败；这会阻止自动采用，即使整体平均分提高。',
    'At least one task changed from pass to fail; this blocks automatic adoption even if the overall average improves.');
  if (cases.some(c => pairs.filter(pair => pair.caseId === c.id && pair.baselineGrade !== null && pair.candidateGrade !== null).length < 3)) {
    block('需要每个任务至少三次完整可比的真实重复。', 'At least three complete comparable real repetitions are required per task.');
  }
  if (pairs.some(pair => pair.outcome === 'unknown')) block('缺少任务、重复、已知评分或无运行器错误的配对记录；未知仍计入预期分母。',
    'Task, repetition, known grade, or harness-error-free paired records are missing; unknowns remain in expected denominators.');
  if (candidate.known !== candidate.expected || candidate.passed !== candidate.expected) block('候选方案尚未通过全部预期任务与重复。', 'The candidate has not passed all expected tasks and repetitions.');
  if (project.cases.some(c => !experiment.caseIds.includes(c.id))) block('项目中仍有未纳入实验的相邻任务；需要显式确认相关任务覆盖。',
    'Some neighboring project tasks are excluded; relevant-task coverage requires explicit confirmation.');
  if (!cases.some(c => c.split === 'confirmation')) block('没有独立的最终确认任务集；训练任务不能代替确认。', 'An independent final-confirmation case set is missing; training cases cannot replace confirmation.');
  if (['taskSet', 'grader', 'nonTarget', 'intervention', 'execution'].some(key => experiment.controls[key as keyof typeof experiment.controls] !== 'verified')
    || experiment.controls.model !== 'same_recorded') block('任务、评分器、模型、非目标角色、单一边界改动或执行环境控制未全部验证。',
    'Task, grader, model, non-target roles, single-boundary intervention, or execution-environment controls are not all verified.');
  const observedSkill = selected.some(trial => trial.variantId === experiment.candidateVariantId
    && trial.events.some(event => event.role === 'skill' || event.name === 'load_skill'));
  const needsAblation = experiment.controls.skillAblation === 'complete'
    || (experiment.operation === 'fold' && (observedSkill || experiment.controls.skillAblation !== 'not_applicable'));
  if (needsAblation && (experiment.controls.skillAblation !== 'complete' || !ablation || ablation.known !== ablation.expected)) {
    block('折叠为技能需要完整保留第三组 skill-off 消融评分；标记 complete 不能代替实际记录。',
      'Folding into a skill requires retained complete grades for a third skill-off variant; a complete flag cannot replace actual records.');
  }
  if (needsAblation && experiment.ablationVariantId !== undefined && selected.some(trial => trial.variantId === experiment.ablationVariantId
    && (trial.events.length === 0 || trial.events.some(event => !event.complete)))) {
    block('skill-off 过程记录缺失或不完整，无法检查实际发现、加载与调用路径。',
      'Skill-off process records are missing or incomplete, so actual discovery, loading, and call paths cannot be inspected.');
  }
  if (selected.some(trial => !realKinds.has(sources.get(trial.sourceId)?.kind ?? ''))) block('来源包含离线、合成或用户自报记录，不能自认证为完整真实对照。',
    'Sources include offline, synthetic, or user-reported records; these cannot self-certify a complete real comparison.');
  if (!selected.length) block('尚无真实试验记录。', 'No real trial records are available.');
  if (selected.some(trial => !trial.evidenceIds.some(id => {
    const source = evidence.get(id); return source?.complete && source.kind === 'grade' && source.sourceId === trial.sourceId;
  }))) block('有评分缺少完整、同来源的原始评分证据。', 'Some grades lack complete original grading evidence from the same source.');
  if (selected.some(trial => {
    const c = cases.find(c => c.id === trial.caseId)!;
    return c.checks.filter(check => check.required).some(check => !trial.checks.some(actual => actual.id === check.id && actual.passed !== null));
  })) block('必要检查存在缺失或未知结果；断言不能拆成独立任务来扩大样本。',
    'Required checks have missing or unknown outcomes; assertions must not be counted as independent tasks.');
  if (selected.some(trial => trial.grade === 1 && trial.checks.some(check => check.passed === false
    && cases.find(c => c.id === trial.caseId)!.checks.some(expected => expected.id === check.id && expected.required)))) {
    block('存在通过评分与必要检查失败相矛盾的记录，需先复核评分器与原始证据。',
      'Some passing grades contradict failed required checks; review the grader and original evidence first.');
  }
  const models = unique(selected.map(trial => trial.model));
  if (models.length !== 1 || models[0] === null) block('实际模型名称缺失或不一致。', 'Actual model names are missing or inconsistent.');
  if (selected.some(trial => trial.events.some(event => !event.complete))) block('过程事件不完整；缺失预览不能用于确定路由或语义保持。',
    'Process events are incomplete; missing previews cannot establish routes or semantic preservation.');
  const changed = pairs.filter(pair => pair.actionsChanged);
  if (changed.length) observations.push({ title: text('动作及完整参数发生变化', 'Actions or complete arguments changed'),
    detail: text(`${changed.length} 个配对的动作名称、顺序或完整参数不同；即使评分相同，也应逐项检查写入与权限。`,
      `${changed.length} pairs differ in action names, order, or full arguments; inspect writes and permissions even when grades match.`), evidenceIds: refs(changed.flatMap(pair => pair.evidenceIds)) });
  const changedRoutes = pairs.filter(pair => JSON.stringify(pair.routeBefore) !== JSON.stringify(pair.routeAfter));
  if (changedRoutes.length) observations.push({ title: text('逐重复执行路线变化', 'Execution routes changed within individual repetitions'),
    detail: text(`${changedRoutes.length} 个配对的顺序路线不同；历史记录没有计时时只展示序列，未跨重复合并 Agent。`,
      `${changedRoutes.length} pairs have different ordered routes. Historic records without timing use sequence only; agents are never unioned across repetitions.`), evidenceIds: refs(changedRoutes.flatMap(pair => pair.evidenceIds)) });
  observations.push({ title: text('任务均分与区间的口径', 'Task-weighted score and interval basis'),
    detail: text('先计算每个独立任务在重复中的平均通过率，再让任务等权。未知使均分不可用；95% 区间使用任务层 Hoeffding 界并假定任务独立，不代表普遍因果证明。',
      'Average repetitions within each independent task, then weight tasks equally. Unknowns make the score unavailable. The 95% interval uses a task-level Hoeffding bound assuming independent tasks; it is not universal causal proof.'), evidenceIds: [] });
  const unscored = selected.length > 0 && selected.every(trial => !realKinds.has(sources.get(trial.sourceId)?.kind ?? '') && grade(trial, project) === null);
  return { experimentId: experiment.id, boundaryId: experiment.boundaryId,
    status: regressions.length ? 'regression' : unscored ? 'unscored' : blockers.length === 0 ? 'supported' : 'needs_evidence',
    baseline, candidate, pairs, regressions, improvements, metrics, coverage, blockers, observations,
    ...(ablation === undefined ? {} : { ablation }) };
}

/** A boundary audit and measured disposition remain separate from human adoption notes. */
export function analyzeFoldingProject(value: FoldingProject): FoldingAnalysis {
  const project = validateFoldingProject(value);
  const experiments = project.experiments.map(experiment => analyzeExperiment(project, experiment));
  const decisions: FoldingBoundaryDecision[] = project.boundaries.map(boundary => {
    const targets = project.agents.filter(agent => boundary.targetAgentIds.includes(agent.id));
    const related = experiments.filter(experiment => experiment.boundaryId === boundary.id);
    const applicable = related.filter(analysis => project.experiments.find(experiment => experiment.id === analysis.experimentId)?.operation === boundary.proposed);
    const protectedBoundary = targets.some(agent => agent.externalOwner === true || agent.talksToUser === true);
    const unknownOwner = targets.some(agent => agent.externalOwner === null || agent.talksToUser === null || agent.owner === null);
    const status: FoldingBoundaryDecision['status'] = protectedBoundary ? 'protected'
      : related.some(experiment => experiment.status === 'regression') ? 'regression'
        : unknownOwner ? 'needs_evidence'
          : applicable.some(experiment => experiment.status === 'supported') ? 'supported'
          : related.length > 0 || unknownOwner ? 'needs_evidence' : 'candidate';
    const nextChecks: FoldingText[] = [];
    if (protectedBoundary) nextChecks.push(text('先征求边界所有者意见并保留其直接对话或外部控制契约。', 'Consult the boundary owner and preserve its direct-dialogue or external-control contract.'));
    if (unknownOwner) nextChecks.push(text('补齐所有者、外部控制与用户直接对话信息，未知不能当作不存在。', 'Obtain owner, external-control, and direct-user-dialogue facts; unknown does not mean absent.'));
    if (!related.length) nextChecks.push(text('建立固定任务、独立确认集与至少三次真实基线/候选配对；每次只改一个边界。', 'Create fixed cases, an independent confirmation set, and at least three real baseline/candidate repetitions; change one boundary at a time.'));
    for (const experiment of related) nextChecks.push(...experiment.blockers);
    return { boundaryId: boundary.id, action: protectedBoundary ? 'keep' : boundary.proposed, status, title: boundary.title,
      rationale: protectedBoundary ? text('该边界有外部所有者或直接用户对话契约，不能仅凭遥测分数自动折叠。',
        'This boundary has external ownership or direct user dialogue and cannot be automatically folded from telemetry scores alone.') : boundary.rationale,
      experimentIds: related.map(experiment => experiment.experimentId), evidenceIds: refs([...boundary.evidenceIds, ...targets.flatMap(agent => agent.evidenceIds), ...related.flatMap(experiment => experiment.regressions.flatMap(pair => pair.evidenceIds))]),
      nextChecks: unique(nextChecks.map(item => JSON.stringify(item))).slice(0, 32).map(item => JSON.parse(item) as FoldingText) };
  });
  const traces = new Map<string, typeof project.traffic>();
  for (const row of project.traffic) { const list = traces.get(row.traceId) ?? []; list.push(row); traces.set(row.traceId, list); }
  const visits = new Map<string, Set<string>>(), adjacent = new Map<string, { left: string; right: string; traces: Set<string>; evidenceIds: string[] }>();
  for (const [traceId, rows] of traces) {
    rows.sort((a, b) => a.sequence - b.sequence);
    for (const row of rows) { const set = visits.get(row.agentId) ?? new Set<string>(); set.add(traceId); visits.set(row.agentId, set); }
    for (let index = 1; index < rows.length; index += 1) {
      const before = rows[index - 1]!, after = rows[index]!; if (before.agentId === after.agentId) continue;
      const key = JSON.stringify([before.agentId, after.agentId]); const item = adjacent.get(key)
        ?? { left: before.agentId, right: after.agentId, traces: new Set<string>(), evidenceIds: [] };
      item.traces.add(traceId); item.evidenceIds.push(before.evidenceId, after.evidenceId); adjacent.set(key, item);
    }
  }
  const coupling = [...adjacent.values()].map(item => {
    const left = visits.get(item.left) ?? new Set<string>(), right = visits.get(item.right) ?? new Set<string>();
    return { left: item.left, right: item.right, traces: item.traces.size,
      coupling: item.traces.size / new Set([...left, ...right]).size, share: item.traces.size / traces.size, evidenceIds: refs(item.evidenceIds) };
  }).sort((a, b) => b.traces - a.traces || a.left.localeCompare(b.left) || a.right.localeCompare(b.right));
  const warnings = [text('组织、角色名、提示词长度、工具数量与共用流量只能形成候选，不能证明拆分或合并更好。主循环不会成为折叠目标。',
    'Organization, personas, prompt length, tool counts, and shared traffic only create candidates; they do not prove folding or merging is better. The main loop is never a folding target.'),
  text('人工保留、回滚、修复与重跑记录独立保存，不会覆盖失败、回归或证据限制。', 'Human keep, revert, fix, and rerun notes are separate and never overwrite failures, regressions, or evidence limits.')];
  if (project.sources.some(source => source.kind === 'synthetic_traffic')) warnings.push(text('流量包含合成数据；相邻调用和耦合率仅描述该样本。', 'Traffic includes synthetic data; adjacency and coupling describe only that sample.'));
  if (project.sources.some(source => source.kind === 'user_import')) warnings.push(text('导入来源为用户自报，不是已验证的官方或本地抓取记录。', 'Imported provenance is user-reported, not authenticated official or local-capture evidence.'));
  if (project.trials.some(trial => Object.keys(trial.byAgent).some(id => !project.agents.some(agent => agent.id === id))
    || trial.events.some(event => event.agentId !== null && !project.agents.some(agent => agent.id === event.agentId)))) {
    warnings.push(text('过程记录含未列入审计清单的角色；保留其原名，但所有者和边界归属未知。',
      'Traces contain roles absent from the audited inventory; their original names are retained, but ownership and boundary attribution are unknown.'));
  }
  warnings.push(text('每条派生结果最多列出 32 个真实来源定位；完整来源仍保存在项目与导出清单中。',
    'Each derived row lists at most 32 real source locations; complete sources remain in the project and exported inventory.'));
  const analysis: FoldingAnalysis = { decisions, experiments, coupling, warnings };
  if (new TextEncoder().encode(JSON.stringify(analysis)).length > FOLDING_MAX_BYTES) throw new RangeError('Folding analysis exceeds the 8MiB report budget');
  return analysis;
}

/** A planning estimate, never a price quote or a promise of a hard maximum API bill. */
export function estimateFoldingPlan(value: FoldingRunPlan, project?: FoldingProject): FoldingEstimate {
  const plan = validateFoldingRunPlan(value);
  const verified = project ? validateFoldingProject(project) : null;
  const eligible = verified?.trials.filter(trial => plan.caseIds.includes(trial.caseId) && trial.harnessError === null
    && realKinds.has(verified.sources.find(source => source.id === trial.sourceId)?.kind ?? '')
    && verified.experiments.some(experiment => experiment.boundaryId === plan.boundaryId && experiment.baselineVariantId === trial.variantId
      && experiment.trialIds.includes(trial.id)) && trial.model === plan.model) ?? [];
  const complete = plan.caseIds.every(id => eligible.some(trial => trial.caseId === id && trial.modelCalls !== null && trial.inputTokens !== null && trial.outputTokens !== null));
  const variants = plan.skillAblation ? 3 : 2;
  const estimate = (key: 'modelCalls' | 'inputTokens' | 'outputTokens') => !complete ? null : Math.ceil(plan.caseIds.reduce((sum, id) => {
    const samples = eligible.filter(trial => trial.caseId === id && trial[key] !== null);
    return sum + samples.reduce((sum, trial) => sum + trial[key]!, 0) / samples.length;
  }, 0) * plan.repetitions * variants);
  return { cases: plan.caseIds.length, repetitions: plan.repetitions, variants, modelCalls: estimate('modelCalls'), inputTokens: estimate('inputTokens'), outputTokens: estimate('outputTokens'),
    basis: complete ? 'measured_baseline' : 'unknown', limitations: [
      'Candidate costs are estimated from the measured baseline and may differ. Nested calls must be included by the runner; do not add overlapping per-agent totals.',
      'Measured token budgets are charged after responses and cannot guarantee an exact maximum bill. No model call or external command was executed to make this estimate.',
      ...(complete ? [] : ['A complete comparable measured baseline for every selected case and the explicit model is missing; unknown usage is not zero.']),
    ] };
}
