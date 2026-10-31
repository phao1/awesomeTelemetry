import type { TaskContext, TaskMetricKey } from '../../core/task-types.js';
import type { Locale } from '../../i18n.js';
import { formatDuration } from '../../core/task-health/format.js';
export function TaskSummaryBar({ context, locale }: { context: TaskContext; locale: Locale }) {
  const zh = locale === 'zh', t = (cn: string, en: string) => zh ? cn : en, unknown = t('未知', 'Unknown');
  const m = context.metrics, task = context.task;
  const partial = (key: TaskMetricKey) => {
    const c = m?.coverage?.[key];
    return c && c.known > 0 && c.known < c.total ? t(` · 部分（${c.known}/${c.total} 成员）`, ` · Partial (${c.known}/${c.total} members)`) : '';
  };
  const number = (v: number | null | undefined, key?: TaskMetricKey) => v == null ? unknown : v.toLocaleString(zh ? 'zh-CN' : 'en-US') + (key ? partial(key) : '');
  const coverageTitle = (basis: string, key?: TaskMetricKey) => {
    const c = key && m?.coverage?.[key];
    if (!c) return basis;
    const reasons = {
      session_unavailable: t('会话不可用或尚未关联', 'Session unavailable or unlinked'),
      detail_not_loaded: t('详情未加载，计数未经确认', 'Detail not loaded; counters unconfirmed'),
      not_reported: t('未报告可信计数或模型，默认零不能证明实测零', 'No trusted counter or model; default zero is not a reported zero'),
      accounting_unknown: t('Token 包含关系未确认，未计入修正总量', 'Token inclusion convention unverified; excluded from corrected total'),
    };
    const omitted = Math.max(0, c.total - c.known - c.missing.length);
    return [basis, t(`已知 ${c.known}/${c.total} 成员。`, `Known ${c.known}/${c.total} members.`), ...c.missing.map(member => `${member.name} (${member.memberId}): ${reasons[member.reason]}`), ...(omitted ? [t(`另 ${omitted} 个成员超出上下文读取上限，无法列出身份。`, `${omitted} additional members exceed the context limit; identities unavailable.`)] : [])].join('\n');
  };
  const states: Record<string, [string, string]> = { success: ['成功', 'Success'], error: ['失败', 'Failed'], running: ['运行中', 'Running'], unknown: ['未知', 'Unknown'], historical: ['历史记录', 'Historical'], completed: ['已完成', 'Completed'], pending: ['待处理', 'Pending'], interrupted: ['已中断', 'Interrupted'] };
  const rows: Array<[string, string, string, TaskMetricKey?]> = [
    [t('状态', 'Status'), states[task.recordedStatus]?.[zh ? 0 : 1] ?? task.recordedStatus, t('主会话记录状态，不代表当前进程状态。', 'Recorded main-session status; not live process state.')],
    [t('开始', 'Started'), task.startedAt && Number.isFinite(Date.parse(task.startedAt)) ? new Date(task.startedAt).toLocaleString(zh ? 'zh-CN' : 'en-NZ', { hour12: false }) : unknown, t('任务主会话的开始时间，以本地时区显示。', 'Main-session start in your local timezone.')],
    [t('墙钟', 'Wall clock'), m?.durationMs == null ? unknown : formatDuration(m.durationMs, locale), t('最早成员开始至最晚成员结束，不累加重叠时长；缺少时长来源时未知。导入使用会话起止时间。', 'Earliest member start to latest member end; overlaps are not added. Unknown without duration provenance. Imports use session endpoints.')],
    [t('成员', 'Members'), number(task.memberCount), t('任务上下文中的成员数。', 'Members in task scope.')],
    [t('事件', 'Events'), number(task.eventCount), t('会话保留事件数之和；导入使用会话 turnCount。', 'Sum of retained session event counts; imports use session turnCount.')],
    [t('工具调用', 'Tool calls'), number(m?.toolCalls), t('已解析成员中 kind=tool 且 input_len>0 的输入记录数，不重复计返回；覆盖不全时未知。', 'Input records with kind=tool and input_len>0, excluding output-only records. Unknown for incomplete coverage.')],
    [t('错误', 'Errors'), number(m?.errors), t('全部成员中 status=error 的保留事件数；覆盖不全时未知。', 'Retained status=error events across all members; unknown for incomplete coverage.')],
    [t('输入 Token', 'Input tokens'), number(m?.input, 'input'), t('适配器归一化后的非缓存输入之和；旧字段默认零无法证明已报告，显示未知。', 'Sum of adapter-normalized uncached input. Legacy zero defaults cannot establish reporting.'), 'input'],
    [t('输出 Token', 'Output tokens'), number(m?.output, 'output'), t('归一化输出之和；不额外加可能已包含的 reasoning。缺失时未知。', 'Normalized output sum; reasoning is not added again. Unknown if missing.'), 'output'],
    [t('缓存读', 'Cache read'), number(m?.cacheRead, 'cacheRead'), t('各成员增量缓存读 Token 之和；默认零不能证明实测零。', 'Sum of incremental cache-read tokens. Default zero does not prove a reported zero.'), 'cacheRead'],
    [t('修正总量', 'Corrected total'), number(m?.correctedTotal, 'correctedTotal'), t('逐会话使用 correctedUsage 再求和，缓存不重复计入；Codex 确认不报告缓存写入时按 0 计，其余包含关系或缓存写入未知时排除该成员。', 'Sum of per-session correctedUsage, without double-counted cache. Confirmed unreported Codex cache writes count as zero; otherwise unproven conventions or counters exclude that member.'), 'correctedTotal'],
    [t('费用', 'Cost'), m?.costUsd == null ? unknown : `$${m.costUsd.toFixed(4)}`, t('仅合计所有成员 cost_source=reported 且币种为 USD 的 sessions.cost_usd；不估算。', 'Only sessions.cost_usd with cost_source=reported and USD for every member; no estimates.')],
    [t('模型', 'Model'), !m?.models.filter(Boolean).length ? unknown : partial('models') ? m.models.filter(Boolean).join(', ') + partial('models') : m.models.length === 1 ? m.models[0]! : t('多个', 'Multiple'), m?.models.filter(Boolean).join(', ') || t('会话 primary_model；缺少模型时未知。', 'Session primary_model; unknown if missing.'), 'models'],
  ];
  return <dl className="task-summary-bar" aria-label={t('任务摘要', 'Task summary')}>{rows.map(([label, value, basis, key]) => <div key={label} title={coverageTitle(basis, key)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
