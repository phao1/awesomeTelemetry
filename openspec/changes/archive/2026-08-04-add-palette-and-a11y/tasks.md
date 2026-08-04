> 详细验收标准见 `UI-TASKS.md` T-23 / T-24。
> 前置：`redesign-frontend-views` 已 archive。

## 1. 快捷键分发（design-system REQ-008）

- [x] 1.1 单一全局 `keydown` 监听 + 映射表（D1）
- [x] 1.2 输入框聚焦或 `isComposing` 时只放行 `Esc`（中文输入法安全）
- [x] 1.3 实现：`1`–`5` 切视图 / `/` 聚焦搜索 / `j`·`k` 浏览 / `Enter` 打开 / `[`·`]` 折叠栏 / `⌘\` 切主题
- [x] 1.4 浮层栈 + `Esc` 按层级出栈关闭（D2）
- [x] 1.5 `?` 快捷键帮助浮层（内容走 i18n）

## 2. 命令面板（frontend REQ-025）

- [x] 2.1 `CommandPalette` 组件：`Modal` 壳 + 搜索输入 + 虚拟滚动结果列表
- [x] 2.2 首次 `⌘K` 才 `import()` 懒加载（D4）
- [x] 2.3 命令项：跳转会话（标题/id 模糊匹配）、切视图、切主题、切语言、触发扫描、打开设置
- [x] 2.4 复用共享会话 store，**不发任何请求**
- [x] 2.5 首屏一行发现性提示（`⌘K 搜索会话 · ? 查看快捷键`），用过一次后不再显示
- [x] 2.6 验收：首屏不实例化面板、不预取全量列表

## 3. URL hash 状态同步（frontend REQ-024）

- [x] 3.1 手写解析/序列化模块（**60 行以内**，不引路由库）
- [x] 3.2 支持 `#/sessions?key=…&phase=…&provider=…`、`#/agents`、`#/compare?left=…&right=…`
- [x] 3.3 单向数据流：状态变写 hash，`hashchange` 解析并应用（D3，避免循环）
- [x] 3.4 脏 hash 回落默认视图，不抛错
- [x] 3.5 验收：`#/compare?left=…&right=…` 刷新后状态保持

## 4. a11y 收口（design-system REQ-009）

- [x] 4.1 语义角色：tabs 用 `role="tablist"`、列表用 `role="listbox"`+`aria-selected`、模态 `role="dialog"`+`aria-modal`
- [x] 4.2 焦点：浮层焦点陷阱、关闭后焦点回归触发元素
- [x] 4.3 `aria-live="polite"`：状态栏连接指示与 Toast
- [x] 4.4 验收：200% 缩放无横向滚动、无内容截断
- [x] 4.5 验收：键盘可完成「打开会话 → 选事件 → 看 Raw → 关闭」全流程
- [x] 4.6 验收：`prefers-reduced-motion` 下动画归零、skeleton shimmer 与 running 脉冲停止

## 5. i18n 与契约断言收口

- [x] 5.1 新增 key 全部补齐 zh + en（`i18n.test.ts` 的键对齐断言必须绿）
- [x] 5.2 `contracts/design-tokens.md` §9 的 T1–T7 七条断言全部在 CI 中执行
- [x] 5.3 端到端冒烟：启动 → `GET /` 200 → 列表首条 title 非文件名 → 点开有事件 → 切 5 视图无 console error
- [x] 5.4 冒烟测试的端口监听要求记入 `RUNBOOK.md`

## 6. 阶段收口

- [x] 6.1 `npm run typecheck && npm run test && npm run lint && npm run perf:check` 全绿
- [x] 6.2 首屏性能实测（`NEXT-TASKS.md` T-07 遗留项），结果追加 `PERF-BASELINE.md`，达不到如实记录
- [x] 6.3 更新 `PROGRESS.md`
- [x] 6.4 `openspec archive add-palette-and-a11y`
