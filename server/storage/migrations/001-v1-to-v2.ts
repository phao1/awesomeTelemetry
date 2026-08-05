/**
 * 首个已落地的迁移：schema v1 → v2（add-mission-control）。
 *
 * 迁移实现与注册在 `server/storage/schema.ts` 的 `migrateSchema()`
 * （幂等 ADD COLUMN；失败抛错并提示删库重扫，不得让库处于半迁移状态）。
 * 本文件是 `contracts/database.md` §2 预留的 `migrations/` 机制的登记入口，
 * 供后续迁移按序号追加，不重复实现逻辑。
 */
export { migrateSchema } from '../schema.js';

export const V2_MIGRATION_STEPS = [
  'sessions: primary_model / cost_source / duration_source',
  'events: model / input_len / output_len',
  'metrics: ttft_ms / e2e_ms',
  'indexes: idx_events_tool / idx_events_session_kind / idx_sessions_started_prov',
] as const;
