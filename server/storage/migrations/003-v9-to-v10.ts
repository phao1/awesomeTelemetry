/**
 * schema v9 → v10（add-agent-team-observability D11）：
 * 新增 13 张 team 主表 + team_message_recipients（收件人归一化 junction）+
 * team_run_sessions（session 链接 junction）及其索引。实现与注册在
 * `server/storage/schema.ts` 的 `migrateSchema()`（幂等
 * CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS；失败抛错并提示
 * 删库重扫，不得让库处于半迁移状态）。本文件是 migrations/ 机制的登记入口。
 */
export { migrateSchema } from '../schema.js';

export const V10_MIGRATION_STEPS = [
  'team_runs',
  'team_agents',
  'team_agent_edges',
  'team_tasks',
  'team_task_dependencies',
  'team_assignments',
  'team_messages',
  'team_message_recipients',
  'team_activities',
  'team_rounds',
  'team_artifacts',
  'team_evidence',
  'team_activity_bodies',
  'team_metrics',
  'team_run_sessions',
  'indexes: idx_team_activities_run_time / run_agent / run_task / '
    + 'idx_team_messages_run_sender / idx_team_message_recipients_agent / '
    + 'idx_team_tasks_run_status / idx_team_edges_run_from_to / '
    + 'idx_team_artifacts_run_created / idx_team_evidence_run / '
    + 'idx_team_runs_provider_started / idx_team_runs_status_started / '
    + 'idx_team_rounds_run_agent / idx_team_assignments_run_task / '
    + 'idx_team_assignments_run_agent / idx_team_deps_run_up / '
    + 'idx_team_run_sessions_session',
] as const;
