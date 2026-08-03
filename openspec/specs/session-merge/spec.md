# Spec: Session Merge

> 会话合并：把多个相关 trace session 合并成一个逻辑会话。源文件：`server/storage/session-merge.ts`

## Purpose

某些 Agent 工作流会产生多个相关会话（主会话 + 子 agent，或空壳 + 真实会话），UI 上需要合并展示。

## Requirements

### REQ-001: 配置驱动
合并由 `config/session-groups.json`（gitignored，机器特定）驱动：

```json
{ "groups": [{ "id": "...", "primaryKey": "...", "title": "...", "sourceAgent": "...", "mergedKeys": ["..."], "reason": "..." }] }
```

复刻时 MUST 提供 `config/session-groups.example.json` 模板。

### REQ-002: 两种合并模式
1. **CodeArts SDD** — 主会话 + 子 agent 会话（spec-requirement-agent / spec-design-agent / spec-task-agent）
2. **Trae 空壳** — 0-event 会话 + 真实会话

### REQ-003: 配置加载与缓存
`loadSessionGroups(configRoot)` SHALL 基于 mtime 缓存失效。

### REQ-004: 反向查找
`buildGroupLookup(configRoot)` SHALL 返回 traceId 到 group 的反向映射。

### REQ-005: 索引合并
`mergeSessionIndex(sessions)` SHALL 把同组会话替换为单个条目：`eventCount` 求和、`startedAt` 取最早、`updatedAt` 取最晚、`mergeGroupId` 置为组 id。

### REQ-006: 详情合并
`mergeSessionDetail(primaryKey, getSessionDetail)` SHALL 合并各组成会话的 events、按 `startedAt` 重排、**重新编号 sequence**、token 总计求和。

#### Scenario: sequence 重排
- **GIVEN** 两个会话各有 sequence 1..N
- **WHEN** 合并
- **THEN** 合并后 sequence MUST 为连续的 1..M，否则 Gantt 树顺序错乱

### REQ-007: 合并与分页的交互
合并组的详情分页 MUST 在合并后的完整 event 序列上做 offset/limit，MUST NOT 分别对各组成会话分页后拼接。

### REQ-008: 主键判定
`getMergeGroup(key)` SHALL 判断 key 是否是某 group 的 primaryKey。

### REQ-009: 合并对增量的影响
组内任一会话变更时，`queueSessionChange` MUST 上报 **primaryKey**，而非变更会话本身的 key。

## Gotchas
- G10.3：合并是手动配置驱动，不是自动检测
- `session-groups.json` 是 gitignored 的机器特定配置
- 合并后 sequence 必须重排
- G11.14（新）：合并组的 SSE 通知要发 primaryKey，否则前端失效了一个它列表里根本不存在的 key
