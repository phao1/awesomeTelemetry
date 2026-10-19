/**
 * add-agent-team-observability §8.7 / §8.8 / §8.13 / §8.14 —
 * EntityInspector：实体检查器组件。
 *
 * 选中 entity 的详情面板，覆盖 agent/task/round/activity/message/artifact/edge
 * 七种 selection kind。
 * - **slim 默认**：从 snapshot 投影元数据，零请求
 * - **body/raw 按 tier 加载**（§8.8）：仅 activity selection 时显示 Load body/raw
 *   按钮，通过 onLoadBody 回调（TeamShell 持有 bounded LRU cache，1 请求/tier）
 * - **六状态**（§7.11）：loading/empty/error+retry/success/partial/unavailable
 * - **provenance**：evidenceIds 列表
 * - **session trajectory jump**：agent.sessionKeys 提供跳转链接（不在此触发）
 * - **completeness/conflict**：显示实体级 completeness（如有）
 *
 * **跨视图高亮**（§8.12）：selection 变化时 inspector 同步更新。
 * **无障碍**（§8.14）：region role、aria-label、键盘、focus-visible。
 * **无新 runtime dependency**。
 *
 * **i18n**：新键在组件内局部双语映射。
 */

import '../../styles/components/team.css';
import '../../styles/components/team-views.css';

import { useCallback, useMemo } from 'react';

import type { Locale, I18nKey } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamArtifact,

  TeamRunSnapshot,
  TeamTask,
} from '../../core/trace-types.js';
import { EmptyState, ErrorState, Skeleton } from '../ui/States.js';
import type {
  TeamActivityDetailResponse,
  TeamSelection,
} from './team-client.js';

// ── 局部双语文字映射 ────────────────────────────────────────

const TT = {
  provenance: { zh: '证据来源', en: 'provenance' },
  evidenceId: { zh: '证据 ID', en: 'evidence id' },
  sessionKeys: { zh: '关联会话', en: 'linked sessions' },
  noProvenance: { zh: '无证据', en: 'no provenance' },
  noSessionKeys: { zh: '无关联会话', en: 'no linked sessions' },
  // agent
  agentRole: { zh: '角色', en: 'role' },
  agentRoleClass: { zh: '角色类别', en: 'role class' },
  agentModel: { zh: '模型', en: 'model' },
  agentState: { zh: '状态', en: 'state' },
  agentCreatedAt: { zh: '创建时间', en: 'created at' },
  agentEndedAt: { zh: '结束时间', en: 'ended at' },
  // task
  taskTitle: { zh: '标题', en: 'title' },
  taskStatus: { zh: '状态', en: 'status' },
  taskPriority: { zh: '优先级', en: 'priority' },
  taskCreatedAt: { zh: '创建时间', en: 'created at' },
  taskStartedAt: { zh: '开始时间', en: 'started at' },
  taskCompletedAt: { zh: '完成时间', en: 'completed at' },
  taskDescriptionAvailable: { zh: '有描述', en: 'description available' },
  taskResultAvailable: { zh: '有结果', en: 'result available' },
  // activity
  activityKind: { zh: '种类', en: 'kind' },
  activityStatus: { zh: '状态', en: 'status' },
  activityStartedAt: { zh: '开始时间', en: 'started at' },
  activityEndedAt: { zh: '结束时间', en: 'ended at' },
  activityAgent: { zh: 'Agent', en: 'agent' },
  activityTask: { zh: '任务', en: 'task' },
  activityRound: { zh: '轮次', en: 'round' },
  // message
  messageMode: { zh: '模式', en: 'mode' },
  messageCategory: { zh: '类别', en: 'category' },
  messageSentAt: { zh: '发送时间', en: 'sent at' },
  messageReceivedAt: { zh: '接收时间', en: 'received at' },
  messageBodyAvailable: { zh: '有正文', en: 'body available' },
  // artifact
  artifactKind: { zh: '种类', en: 'kind' },
  artifactName: { zh: '名称', en: 'name' },
  artifactPath: { zh: '路径（脱敏）', en: 'path (redacted)' },
  artifactHasContent: { zh: '有内容', en: 'has content' },
  artifactCreatedAt: { zh: '创建时间', en: 'created at' },
  // edge
  edgeKind: { zh: '边种类', en: 'edge kind' },
  edgeFrom: { zh: '从', en: 'from' },
  edgeTo: { zh: '到', en: 'to' },
  edgeValidFrom: { zh: '生效自', en: 'valid from' },
  edgeValidTo: { zh: '生效至', en: 'valid to' },
  // body
  loadBody: { zh: '加载 body', en: 'load body' },
  loadRaw: { zh: '加载 raw', en: 'load raw' },
  bodyInput: { zh: '输入', en: 'input' },
  bodyOutput: { zh: '输出', en: 'output' },
  bodyMessage: { zh: '消息', en: 'message' },
  bodyResult: { zh: '结果', en: 'result' },
  bodyRaw: { zh: '原始', en: 'raw' },
  bodyEmpty: { zh: '无 body', en: 'no body' },
  bodyEmptyHint: { zh: '该活动无 body/raw 行', en: 'no body/raw rows for this activity' },
  bodyUnavailable: { zh: 'body/raw 不可用', en: 'body/raw unavailable' },
  // misc
  notFound: { zh: '实体未找到', en: 'entity not found' },
  notFoundHint: { zh: '该实体不在当前快照中', en: 'entity not present in current snapshot' },
  yes: { zh: '是', en: 'yes' },
  no: { zh: '否', en: 'no' },
  unknown: { zh: '未知', en: 'unknown' },
} as const;

function tt(entry: { zh: string; en: string }, locale: Locale): string {
  return locale === 'zh' ? entry.zh : entry.en;
}

// ── PanelState（与 TeamShell 一致） ─────────────────────────

type PanelState = 'loading' | 'empty' | 'error' | 'success' | 'partial' | 'unavailable';

// ── 通用字段行 ──────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: string | null | undefined }): React.JSX.Element {
  if (value === null || value === undefined || value === '') return <></>;
  return (
    <div className="team-inspector-field">
      <dt className="team-inspector-field-label">{label}</dt>
      <dd className="team-inspector-field-value">{value}</dd>
    </div>
  );
}

function BoolFieldRow({ label, value, locale }: { label: string; value: boolean; locale: Locale }): React.JSX.Element {
  return (
    <div className="team-inspector-field">
      <dt className="team-inspector-field-label">{label}</dt>
      <dd className="team-inspector-field-value">{value ? tt(TT.yes, locale) : tt(TT.no, locale)}</dd>
    </div>
  );
}

function EvidenceList({
  evidenceIds,
  locale,
}: {
  evidenceIds: string[];
  locale: Locale;
}): React.JSX.Element {
  if (evidenceIds.length === 0) {
    return (
      <div className="team-inspector-provenance-empty">{tt(TT.noProvenance, locale)}</div>
    );
  }
  return (
    <div className="team-inspector-provenance" role="list" aria-label={tt(TT.provenance, locale)}>
      <div className="team-inspector-provenance-title">{tt(TT.provenance, locale)}</div>
      <ul className="team-inspector-evidence-list">
        {evidenceIds.map((id) => (
          <li key={id} className="team-inspector-evidence-id mono" role="listitem">
            {id}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 实体详情渲染 ────────────────────────────────────────────

function AgentDetail({ agent, locale }: { agent: TeamAgent; locale: Locale }): React.JSX.Element {
  return (
    <dl className="team-inspector-fields">
      <FieldRow label={tt(TT.agentRole, locale)} value={agent.role} />
      <FieldRow label={tt(TT.agentRoleClass, locale)} value={agent.roleClass} />
      <FieldRow label={tt(TT.agentModel, locale)} value={agent.model} />
      <FieldRow label={tt(TT.agentState, locale)} value={agent.state} />
      <FieldRow label={tt(TT.agentCreatedAt, locale)} value={agent.createdAt} />
      <FieldRow label={tt(TT.agentEndedAt, locale)} value={agent.endedAt} />
      <div className="team-inspector-field">
        <dt className="team-inspector-field-label">{tt(TT.sessionKeys, locale)}</dt>
        <dd className="team-inspector-field-value">
          {agent.sessionKeys.length === 0
            ? tt(TT.noSessionKeys, locale)
            : agent.sessionKeys.join(', ')}
        </dd>
      </div>
      <EvidenceList evidenceIds={agent.evidenceIds} locale={locale} />
    </dl>
  );
}

function TaskDetail({ task, locale }: { task: TeamTask; locale: Locale }): React.JSX.Element {
  return (
    <dl className="team-inspector-fields">
      <FieldRow label={tt(TT.taskTitle, locale)} value={task.title} />
      <FieldRow label={tt(TT.taskStatus, locale)} value={task.status} />
      <FieldRow label={tt(TT.taskPriority, locale)} value={task.priority !== null ? String(task.priority) : null} />
      <FieldRow label={tt(TT.taskCreatedAt, locale)} value={task.createdAt} />
      <FieldRow label={tt(TT.taskStartedAt, locale)} value={task.startedAt} />
      <FieldRow label={tt(TT.taskCompletedAt, locale)} value={task.completedAt} />
      <BoolFieldRow label={tt(TT.taskDescriptionAvailable, locale)} value={task.descriptionAvailable} locale={locale} />
      <BoolFieldRow label={tt(TT.taskResultAvailable, locale)} value={task.resultAvailable} locale={locale} />
      <EvidenceList evidenceIds={task.evidenceIds} locale={locale} />
    </dl>
  );
}

function ActivityDetail({
  activity,
  locale,
}: {
  activity: TeamActivitySlim;
  locale: Locale;
}): React.JSX.Element {
  return (
    <dl className="team-inspector-fields">
      <FieldRow label={tt(TT.activityKind, locale)} value={activity.kind} />
      <FieldRow label={tt(TT.activityStatus, locale)} value={activity.status} />
      <FieldRow label={tt(TT.activityStartedAt, locale)} value={activity.startedAt} />
      <FieldRow label={tt(TT.activityEndedAt, locale)} value={activity.endedAt} />
      <FieldRow label={tt(TT.activityAgent, locale)} value={activity.agentId} />
      <FieldRow label={tt(TT.activityTask, locale)} value={activity.taskId} />
      <FieldRow label={tt(TT.activityRound, locale)} value={activity.roundId} />
      <EvidenceList evidenceIds={activity.evidenceIds} locale={locale} />
    </dl>
  );
}


function ArtifactDetail({
  artifact,
  locale,
}: {
  artifact: TeamArtifact;
  locale: Locale;
}): React.JSX.Element {
  return (
    <dl className="team-inspector-fields">
      <FieldRow label={tt(TT.artifactKind, locale)} value={artifact.kind} />
      <FieldRow label={tt(TT.artifactName, locale)} value={artifact.name} />
      <FieldRow label={tt(TT.artifactPath, locale)} value={artifact.pathRedacted} />
      <BoolFieldRow label={tt(TT.artifactHasContent, locale)} value={artifact.hasContent} locale={locale} />
      <FieldRow label={tt(TT.artifactCreatedAt, locale)} value={artifact.createdAt} />
      <EvidenceList evidenceIds={artifact.evidenceIds} locale={locale} />
    </dl>
  );
}

function EdgeDetail({
  edge,
  fromAgent,
  toAgent,
  locale,
}: {
  edge: TeamAgentEdge;
  fromAgent: TeamAgent | undefined;
  toAgent: TeamAgent | undefined;
  locale: Locale;
}): React.JSX.Element {
  return (
    <dl className="team-inspector-fields">
      <FieldRow label={tt(TT.edgeKind, locale)} value={edge.kind} />
      <FieldRow label={tt(TT.edgeFrom, locale)} value={fromAgent?.displayName ?? edge.fromAgentId} />
      <FieldRow label={tt(TT.edgeTo, locale)} value={toAgent?.displayName ?? edge.toAgentId} />
      <FieldRow label={tt(TT.edgeValidFrom, locale)} value={edge.validFrom} />
      <FieldRow label={tt(TT.edgeValidTo, locale)} value={edge.validTo} />
      <EvidenceList evidenceIds={edge.evidenceIds} locale={locale} />
    </dl>
  );
}

// ── body/raw detail（§8.8） ─────────────────────────────────

function BodyDetail({
  bodyDetail,
  bodyState,
  bodyError,
  locale,
  onLoadBody,
  activityId,
}: {
  bodyDetail: TeamActivityDetailResponse | null;
  bodyState: PanelState;
  bodyError: string | null;
  locale: Locale;
  onLoadBody: (activityId: string, tier: 'body' | 'raw') => void;
  activityId: string;
}): React.JSX.Element {
  if (bodyState === 'loading') {
    return (
      <div className="team-inspector-body-loading">
        <Skeleton variant="row" count={3} />
      </div>
    );
  }
  if (bodyState === 'error') {
    return (
      <ErrorState
        code="TEAM_BODY_UNAVAILABLE"
        message={bodyError ?? ''}
        onRetry={() => onLoadBody(activityId, 'body')}
      />
    );
  }
  if (bodyState === 'unavailable') {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={tt(TT.bodyUnavailable, locale)}
      />
    );
  }
  if (bodyDetail === null) {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={tt(TT.bodyEmpty, locale)}
        description={tt(TT.bodyEmptyHint, locale)}
      />
    );
  }
  return (
    <div className="team-inspector-body-content">
      {bodyDetail.body !== null && (
        <dl className="team-inspector-body-dl">
          {bodyDetail.body.input !== null && (
            <div className="team-inspector-body-row">
              <dt>{tt(TT.bodyInput, locale)}</dt>
              <dd><pre className="mono">{bodyDetail.body.input}</pre></dd>
            </div>
          )}
          {bodyDetail.body.output !== null && (
            <div className="team-inspector-body-row">
              <dt>{tt(TT.bodyOutput, locale)}</dt>
              <dd><pre className="mono">{bodyDetail.body.output}</pre></dd>
            </div>
          )}
          {bodyDetail.body.message !== null && (
            <div className="team-inspector-body-row">
              <dt>{tt(TT.bodyMessage, locale)}</dt>
              <dd><pre className="mono">{bodyDetail.body.message}</pre></dd>
            </div>
          )}
          {bodyDetail.body.result !== null && (
            <div className="team-inspector-body-row">
              <dt>{tt(TT.bodyResult, locale)}</dt>
              <dd><pre className="mono">{bodyDetail.body.result}</pre></dd>
            </div>
          )}
        </dl>
      )}
      {bodyDetail.raw !== null && (
        <pre className="team-inspector-body-raw mono">{bodyDetail.raw}</pre>
      )}
    </div>
  );
}

// ── EntityInspectorProps ────────────────────────────────────

export interface EntityInspectorProps {
  selection: TeamSelection | null;
  snapshot: TeamRunSnapshot;
  /** body detail（TeamShell 持有 bounded LRU cache，§8.8）。 */
  bodyDetail: TeamActivityDetailResponse | null;
  bodyState: PanelState;
  bodyError: string | null;
  locale: Locale;
  /** 显式加载 body/raw tier（1 请求/tier，§8.8）。 */
  onLoadBody: (activityId: string, tier: 'body' | 'raw') => void;
}

// ── EntityInspector ─────────────────────────────────────────

export function EntityInspector({
  selection,
  snapshot,
  bodyDetail,
  bodyState,
  bodyError,
  locale,
  onLoadBody,
}: EntityInspectorProps): React.JSX.Element {
  const agentById = useMemo(
    () => new Map(snapshot.agents.map((a) => [a.id, a])),
    [snapshot.agents],
  );
  const taskById = useMemo(
    () => new Map(snapshot.tasks.map((tk) => [tk.id, tk])),
    [snapshot.tasks],
  );
  const artifactById = useMemo(
    () => new Map(snapshot.artifacts.map((ar) => [ar.id, ar])),
    [snapshot.artifacts],
  );
  const edgeById = useMemo(
    () => new Map(snapshot.agentEdges.map((e) => [e.id, e])),
    [snapshot.agentEdges],
  );

  const handleLoadBody = useCallback(
    (tier: 'body' | 'raw') => {
      if (selection !== null && selection.kind === 'activity') {
        onLoadBody(selection.id, tier);
      }
    },
    [selection, onLoadBody],
  );

  if (selection === null) {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('team.inspectorEmpty', locale)}
        description={t('team.inspectorEmptyHint', locale)}
      />
    );
  }

  const kindLabel = t(`team.selectionKind.${selection.kind}` as I18nKey, locale);
  let detail: React.JSX.Element | null = null;
  let entityFound = true;

  if (selection.kind === 'agent') {
    const agent = agentById.get(selection.id);
    if (agent === undefined) {
      entityFound = false;
    } else {
      detail = <AgentDetail agent={agent} locale={locale} />;
    }
  } else if (selection.kind === 'task') {
    const task = taskById.get(selection.id);
    if (task === undefined) {
      entityFound = false;
    } else {
      detail = <TaskDetail task={task} locale={locale} />;
    }
  } else if (selection.kind === 'activity') {
    // activity slim 不在 snapshot（§7.2），由 TeamShell 单独持有 activities 列表。
    // 此处用 bodyDetail.activity（若已加载）或最小占位。
    const activity = bodyDetail?.activity ?? null;
    if (activity !== null) {
      detail = <ActivityDetail activity={activity} locale={locale} />;
    } else {
      detail = (
        <dl className="team-inspector-fields">
          <div className="team-inspector-field">
            <dt className="team-inspector-field-label">{t('team.inspectorLabel', locale)}</dt>
            <dd className="team-inspector-field-value mono">{selection.id}</dd>
          </div>
        </dl>
      );
    }
  } else if (selection.kind === 'message') {
    // message 不在 snapshot（§7.2），由 CommunicationView 持有。
    // 此处显示 id 占位（不伪造元数据）。
    detail = (
      <dl className="team-inspector-fields">
        <div className="team-inspector-field">
          <dt className="team-inspector-field-label">{t('team.inspectorLabel', locale)}</dt>
          <dd className="team-inspector-field-value mono">{selection.id}</dd>
        </div>
      </dl>
    );
  } else if (selection.kind === 'artifact') {
    const artifact = artifactById.get(selection.id);
    if (artifact === undefined) {
      entityFound = false;
    } else {
      detail = <ArtifactDetail artifact={artifact} locale={locale} />;
    }
  } else if (selection.kind === 'edge') {
    const edge = edgeById.get(selection.id);
    if (edge === undefined) {
      entityFound = false;
    } else {
      detail = (
        <EdgeDetail
          edge={edge}
          fromAgent={agentById.get(edge.fromAgentId)}
          toAgent={agentById.get(edge.toAgentId)}
          locale={locale}
        />
      );
    }
  } else if (selection.kind === 'round') {
    // round 不在 snapshot（§7.2），显示 id 占位。
    detail = (
      <dl className="team-inspector-fields">
        <div className="team-inspector-field">
          <dt className="team-inspector-field-label">{t('team.inspectorLabel', locale)}</dt>
          <dd className="team-inspector-field-value mono">{selection.id}</dd>
        </div>
      </dl>
    );
  }

  if (!entityFound) {
    return (
      <div className="team-inspector-panel" aria-label={t('team.inspectorLabel', locale)}>
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={tt(TT.notFound, locale)}
          description={tt(TT.notFoundHint, locale)}
        />
      </div>
    );
  }

  return (
    <div
      className="team-inspector-panel team-inspector-entity"
      role="region"
      aria-label={t('team.inspectorLabel', locale)}
    >
      <div className="team-inspector-header">
        <span className="team-inspector-kind">{kindLabel}</span>
        <span className="team-inspector-id mono">{selection.id}</span>
      </div>
      {detail}
      {selection.kind === 'activity' && (
        <div className="team-inspector-body">
          <div className="team-inspector-body-actions">
            <button
              type="button"
              className="btn ui-btn-sm"
              onClick={() => handleLoadBody('body')}
            >
              {tt(TT.loadBody, locale)}
            </button>
            <button
              type="button"
              className="btn ui-btn-sm"
              onClick={() => handleLoadBody('raw')}
            >
              {tt(TT.loadRaw, locale)}
            </button>
          </div>
          <BodyDetail
            bodyDetail={bodyDetail}
            bodyState={bodyState}
            bodyError={bodyError}
            locale={locale}
            onLoadBody={onLoadBody}
            activityId={selection.id}
          />
        </div>
      )}
    </div>
  );
}
