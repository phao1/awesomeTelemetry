/**
 * agent-collaboration-replay §2.1 — session → team run 反查客户端。
 *
 * 对应后端 `GET /api/sessions/:key/team-run`：按 session key 查关联的
 * team run id 列表（按 started_at DESC 排序）。空数组 = 该 session 不属于
 * 任何 team run，前端据此隐藏「Agent 协作回放」章节。
 *
 * 只返回 id 列表，不返回 team run 详情；前端拿到 id 后复用
 * `teamApi.runSnapshot(runId)` 和 `teamApi.listActivities(runId)` 拉取详情
 * （复用既有 §7.2 / §7.3 端点，不新增 body 字段）。
 *
 * session 不存在 → 404 SESSION_NOT_FOUND（由 fetchJson 抛出 ApiError）。
 */

import { fetchJson } from './client.js';

/** §2.1 响应：关联的 team run id 列表。 */
export interface SessionTeamRunResponse {
  /** 按 started_at DESC 排序的 team run id。空数组 = 无关联。 */
  runIds: string[];
}

/**
 * 按 session key 拉取关联的 team run id 列表。
 * 预算：< 5ms（主键 + 索引查询，nfr.md §2.3）。
 */
export function getTeamRunBySessionKey(sessionKey: string): Promise<SessionTeamRunResponse> {
  return fetchJson<SessionTeamRunResponse>(
    `/sessions/${encodeURIComponent(sessionKey)}/team-run`,
  );
}
