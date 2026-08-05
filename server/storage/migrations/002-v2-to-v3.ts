/**
 * schema v2 → v3（add-mission-control 性能升级）：
 * `metrics.repair_loop` —— repair 检测由逐请求全表窗口扫描（40ms，超 §7.3 R1
 * 预算）改为扫描时预计算。实现与注册在 `server/storage/schema.ts` 的
 * `migrateSchema()`，本文件是 migrations/ 机制的登记入口。
 */
export { migrateSchema } from '../schema.js';

export const V3_MIGRATION_STEPS = [
  'metrics: repair_loop INTEGER NOT NULL DEFAULT 0',
] as const;
