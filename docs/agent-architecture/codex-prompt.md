# 给 Codex 的启动提示（可直接粘贴）

> 仓库：`/Users/penghao/Documents/code/telemetry/awesomeTelemetry`
> 基于分支：`codex/agent-boundary-baseline`（本地分支，没有推送到远端）
> 新建工作分支：`codex/agent-architecture-r4`

---

请在 awesomeTelemetry 仓库实现「Agent 架构决策」功能，规格是 `docs/agent-architecture/spec-r4.md`。

**开工**

1. 先运行 `git switch codex/agent-boundary-baseline`，确认工作区是干净的，再运行 `git switch -c codex/agent-architecture-r4`。之后所有工作都在这个分支上做。工作区不干净时，停下来报告，**不要 reset、checkout、stash 或删除任何东西**。
2. 完整阅读：
   - `AGENTS.md`、`BOOTSTRAP.md`；
   - `docs/agent-architecture/spec-r4.md`（唯一权威来源）；
   - `docs/agent-architecture/wireframes/README.md` 和 7 个 `.dc.html` 线框（只当布局和字段参考，样式用项目现有的设计令牌和组件）；
   - `openspec/contracts/agent-folding.md`、`openspec/specs/agent-folding/spec.md`、`openspec/contracts/benchmark.md`；
   - `data/agent-folding/single-agent-loop-kit/` 下的 `README.md`、`skill/SKILL.md`、`skill/steps/00-audit.md`、`skill/steps/01-baseline.md`，以及 `skill/scripts/` 下的 4 个脚本。
3. `docs/agent-boundary-decision-{prd,design}.md` 只作背景参考，和 spec-r4 冲突时以 spec-r4 为准。**不要新建 `agent-boundary` 模块、`ab_*` 表，也不要加 `/api/agent-boundary/*` 路由**；在现有的 `agent-folding` 模块上扩展。

**推进方式**

4. 按 spec-r4 §5 的顺序推进：P0 → P1 → … → P7。新增的字段、路由、类型先写进 `openspec/contracts/*`，再写代码。
5. **P0 必须先用本机真实的 Claude Code 子 Agent 运行记录做核实。** 本机没有这类记录时，停下来告诉我需要什么，不要编造数据或假设格式。真实记录的内容不得提交，只提交脱敏后的 fixture。
6. **P3 对拍时，kit 的 Python 脚本是标准答案。** TS 结果和它不一致时，先报告差异，不要改 golden 去迁就实现。
7. 每个阶段结束都要：
   - 运行 `npm run typecheck && npm run test && npm run lint`（P5 和 P6 结束时另跑 `npm run build` 和 `npm run perf:check`）；
   - 在本地提交一次，提交信息沿用仓库格式（如 `M12: agent-folding — …`）；
   - 停下来，按 `AGENTS.md` 的格式汇报：完成项、测试依据、截图（P6 起）、未验证项，以及和规格不一致的地方。

   我确认后再进入下一阶段。

**护栏**

8. 监控、代理、Frida 保持默认关闭；开发和测试中不发起任何真实的付费模型调用（模型协议一律用本地替身服务）；不执行用户的业务任务；不修改用户的 Agent 配置。
9. 测试失败时修实现，不放宽断言、阈值或性能预算；不 mock 被测逻辑。
10. 遇到以下情况先停下来问：
    - 契约里没有的字段；
    - 文档之间冲突；
    - 真实数据和规格的假设不一致；
    - 需要新的依赖；
    - 需要新的数据库表；
    - 性能超出预算。
11. **不要推送**到远端，也不要开 PR。

全部完成后，在最后一次汇报里给出：
- 每个阶段的提交号；
- 浏览器验收步骤：用真实数据走完 审计 → 判定卡 → 多选对比 → 导出报告；
- 已知限制。

我会另外安排一次独立验证。
