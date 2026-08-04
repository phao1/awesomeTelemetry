# DECISIONS-PENDING.md — 待决决策

> 无人值守长跑中无法等人工确认的决策都记在这里。
> 格式：编号 / 问题描述 / 尝试过的方案 / 失败原因（如适用）/ 建议的下一步。

---

## D-001 规则文件缺失

- **问题描述**：目标指令要求先读 AUTOPILOT.md / PROGRESS.md / RUNBOOK.md，但仓库（含 git 历史）
  中不存在这三个文件，AGENTS.md / BOOTSTRAP.md 中也没有引用或说明。
- **尝试过的方案**：全仓库搜索（maxdepth 4）、git 历史全量检查、解压 agent-observability-dev-kit.zip
  比对——均无这三个文件。
- **失败原因**：文件从未被创建或未随仓库提交。
- **临时方案**：按目标指令内嵌的规则重建 AUTOPILOT.md / RUNBOOK.md / PROGRESS.md，
  内容明确标注「重建」。目标指令中引用的章节编号（§一禁令、§三卡住、§五预授权、§八终止报告、
  RUNBOOK §三五阶段）均已在重建文件中落地。
- **建议的下一步**：人工确认重建内容与原始意图一致；如原始文件存在，用原始版本替换。

---

## D-002 idx_proxy_started_len 索引列序与 §5.3 期望计划冲突

- **问题描述**：contracts/database.md §4 定义
  `idx_proxy_started_len ON proxy_requests(started_at, system_prompt_len DESC)`，
  但 §5.3 对 `WHERE started_at BETWEEN ? AND ? AND system_prompt_len > 0
  ORDER BY system_prompt_len DESC LIMIT 1` 的期望计划是 `SEARCH ... USING INDEX idx_proxy_started_len`
  且「不得出现 USE TEMP B-TREE」。两者在 SQLite 下无法同时成立。
- **尝试过的方案**：实测三种索引形态——(started_at, system_prompt_len DESC) 必然
  `USE TEMP B-TREE FOR ORDER BY`（空表/有数据均如此）；(system_prompt_len DESC, started_at) 的计划
  恰为 `SEARCH proxy_requests USING INDEX idx_proxy_started_len (system_prompt_len>?)`，无临时 B 树，
  LIMIT 1 可短路。
- **失败原因**：SQLite 规划器对「按 A 范围过滤 + 按 B 排序」只能用 (A, B) 覆盖搜索，无法复用
  第二列做全局排序；§4 的列序与 §5.3 的期望计划本身矛盾。
- **临时方案**：将索引改为 `(system_prompt_len DESC, started_at)`（schema.ts 已改，含 TODO 标记），
  语义不变（窗口内最长 prompt），验收测试不改。
- **建议的下一步**：人工确认后更新 contracts/database.md §4 的索引行，消除文档内部矛盾。

---

## D-003 scanner 级 JSONL 尾部增量读待接线（F11）

- **问题描述**：REQ-008 的 readJsonlFrom 已支持 byte-offset 增量读，但 scanner 层
  （scanJsonlFile）对变更文件一律全量重读。原因是增量读只返回尾部新行，无法单独重建
  会话级聚合（tokenUsage / eventCount / totalDurationMs 需要全量视图）。
- **尝试过的方案**：考虑「尾行记录 + 与已存会话聚合合并」的方案，需要为每个 adapter
  定义增量合并语义，且首轮/重启后无 prevHeadHash 可校验头部是否重写，风险高于收益。
- **失败原因**：无（主动取舍）。全量重读保证正确性；F11 的收益（739MB 文件只读尾部）
  在连续监视场景下可后续补做。
- **临时方案**：全量重读，代码中已留 TODO(D-003) 标记；M4 的 readJsonlFrom 增量能力
  与单元测试保留。
- **建议的下一步**：若 codeagent 类大文件成为瓶颈，实现「尾行记录 + 已存会话聚合合并」，
  并在 scan_state 或内存缓存中记录首 4KB hash 用于重写检测。
