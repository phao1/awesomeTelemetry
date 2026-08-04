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

---

## D-005 会话列表行由「紧凑单行」细化为「44px 双行密排」

- **问题描述**：`specs/frontend/spec.md` REQ-011 与 `gotchas.md` G7.3 原文为
  「列表用紧凑单行，不用多行卡片」。本次设计刷新把会话列表行定为
  `--row-lg`(44px) 双行密排（首行标题、次行 provider/时间/计数）。
  按禁令 A（不违背已确认行为），需留痕说明为何这不是违规。
- **依据**：约束的实质是「密排、非留白型卡片」，反面是 v4 的多行卡片式列表。
  单行在本项目的真实数据下会强制截断唯一有意义的标签——实测一行只放得下
  `rollout-2026-08-04T14-08-32-019fcb63…jsonl`，provider / 时间 / 事件数
  全部挤不进去，用户必须点开才知道每一行是什么。
  GitHub 的通知/PR 列表同样是双行密排，并非卡片。
- **尝试过的方案**：单行 + tooltip 补充 meta——被否，因为 meta 是筛选决策依据，
  必须常驻可见；tooltip 无法扫视比较。
- **失败原因**：无（主动取舍）。
- **临时方案**：REQ-011 原文保留「密排非卡片」的实质，加一段细化说明并指向本条；
  事件行仍为 `--row-sm`(28px) 单行，未放宽。
- **建议的下一步**：人工确认后，同步更新 `gotchas.md` G7.3 的措辞，
  把「紧凑单行」改为「紧凑密排、非卡片」，消除字面歧义。

---

## D-006 REQ-001 文件级门禁与 REQ-022 按会话惰性加载的张力

- **问题描述**：REQ-001 要求「任何详情读取前 MUST 先经过 shouldRescan 文件级门禁，
  判定未变更时 MUST 直接返回」；REQ-022 / T-11 要求 SQLite 多会话按
  「db 路径 + 行内 session id」定位单个会话。若严格执行文件级门禁，会出现
  「db 未变更但某会话从未加载过 → 直接返回 → 该会话永远点不开」的死锁
  （P1-2 的同类问题）。
- **尝试过的方案**：方案 A「首开整库解析、全库落库」（T-03 现状）——满足 REQ-001，
  但违背 T-11「定位到具体会话」且首开做无用功；方案 B「按会话定位解析 + 跳过
  文件级门禁」（已采用）——惰性加载只解析目标会话，detail_loaded 作为会话级门禁，
  文件级门禁保留给全量扫描（POST /api/scan）。
- **失败原因**：无（主动取舍）。scan_state 以 source_path 为主键，无 schema 变更
  的前提下无法做会话级 scan_state（change 声明「无 schema 变更」）。
- **临时方案**：`scanSqliteSessionDetail` 绕过文件级门禁，代码中留 `TODO(D-006)` 标记；
  全量扫描路径 `scanSqliteFile` 仍走文件级门禁。
- **建议的下一步**：人工确认后，在 `specs/session-scanning/spec.md` REQ-001 补一句
  「SQLite 多会话的惰性详情以 sessions.detail_loaded 为会话级门禁，文件级门禁
  适用于全量扫描」，消除两需求字面冲突。

## D-007 Trae 索引标题「置 null」与 SessionIndexEntry.title: string 的类型张力

- **问题描述**：REQ-021 对 Trae（SQLCipher）写「解密就绪前置 `null` + `pending`，
  就绪后回填」，但 `contracts/data-model.md` 的 `SessionIndexEntry.title` 是
  非空 `string`，列表接口没有 null 通道（change 声明「无 BREAKING、不改变已有
  响应结构」）。
- **尝试过的方案**：把 title 改为 `string | null`——需要改 data-model 契约 + API
  类型 + 前端四态，超出本 change 范围；保持 string 并用 D5 回落占位标题
  （`<trae> session · <时间>`）——已采用，比旧行为（文件名冒充）更诚实。
- **失败原因**：无（主动取舍）。Trae 在 macOS 无法验证（P-3 裁剪），
  不影响其余 8 个 provider。
- **临时方案**：Trae 索引条目沿用 `buildIndexEntry` 的 D5 回落标题；
  解密详情回填后由 detail 阶段覆盖真实标题。
- **建议的下一步**：人工确认后决定是否在后续 change 中把
  `SessionIndexEntry.title` 放宽为 `string | null` 并在前端渲染 pending 占位。

---

## D-008 design-tokens.md §2.4 与 §2.7 自冲突：light attention-emphasis 对比度不达标

- **问题描述**：契约 §2.4 表给 light 主题 `--attention-emphasis: #bf8700`，
  但 §2.7 硬性要求「`--fg-on-emphasis` on 任一 `*-emphasis` ≥ 4.5:1」——
  实测白字 on #bf8700 只有 3.14:1，同一文档内部矛盾。
- **尝试过的方案**：候选值实测——#9e6a03（4.65 ✅）、#9a6700（4.87 ✅）、
  #a86c00（4.37 ❌）、#b87d00（3.52 ❌）。
- **失败原因**：无（契约自身数值冲突；§9 断言是契约的可执行形式，断言优先）。
- **临时方案**：light `--attention-emphasis` 改为 `#9e6a03`（与 dark 主题同色相，
  白字 4.65:1 达标）；其余值逐字采用契约。T4 断言不改。
- **建议的下一步**：人工确认后把 `contracts/design-tokens.md` §2.4 的
  light attention-emphasis 值同步改为 `#9e6a03`，消除文档自冲突。
