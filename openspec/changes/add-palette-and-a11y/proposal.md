## Why

前三个 change 让产品可用且好看，但还不「顺手」。开发者工具的顺手体现在两处：
**键盘不离手**（⌘K 跳转、j/k 浏览、数字键切视图）与**状态可分享**
（把一个 URL 发给同事，他打开就是同一个会话同一个过滤）。

同时 a11y 与契约断言需要在此收口——`contracts/design-tokens.md` §9 的七条断言、
`specs/design-system/spec.md` REQ-009 的可访问性要求，都应在功能齐备后统一验收，
避免在前三个 change 里反复返工。

## What Changes

- 命令面板（⌘K）：跳转会话、切视图、切主题/语言、触发扫描、打开设置；
  懒加载、结果虚拟滚动、复用共享 store 不发请求。
- 全套快捷键：`1`–`5` 切视图、`/` 聚焦搜索、`j`/`k` 浏览、`Enter` 打开、
  `Esc` 关闭、`[`/`]` 折叠栏、`⌘\` 切主题、`?` 帮助。
- URL hash 状态同步：视图、选中会话、过滤条件可分享可刷新保持（手写 60 行内，不引路由库）。
- a11y 收口：焦点管理、语义角色、`aria-live`、200% 缩放、`prefers-reduced-motion`。
- i18n 补全与七条契约断言进 CI，加一条端到端冒烟。

无 BREAKING。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无 delta。本 change 实现 `specs/frontend/spec.md` REQ-024/025 与
`specs/design-system/spec.md` REQ-008/009，规格已先行落地，故 `skip_specs: true`。

## Impact

| 面 | 影响 |
|----|------|
| 代码 | 新增 `CommandPalette`（懒加载）、快捷键 hook、hash 路由模块；各视图补 aria 属性 |
| 依赖 | 前置 `redesign-frontend-views`。**0 新增依赖**——不引路由库、不引快捷键库 |
| 测试 | 补端到端冒烟：启动 → `GET /` 200 → 首条 title 非文件名 → 点开有事件 → 切 5 视图无 console error |
| 性能 | 命令面板不得拖慢首屏：首次按 ⌘K 才实例化，不预取全量 |
