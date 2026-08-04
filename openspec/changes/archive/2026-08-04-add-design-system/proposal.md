## Why

现状 `src/styles.css` 只有 72 行、30+ 处硬编码 hex、零 CSS 变量、零图标。
这不是审美问题而是结构问题：**没有 token 层，就加不上暗色模式**；
没有基础组件，每个视图各写各的按钮和表格。

产品定位是「开发者最愿意打开的 Agent 可观测工具」，参照 GitHub / Linear / Grafana。
在画任何页面之前，必须先有可被主题覆盖的 token 层和一套统一的原子组件。

## What Changes

- 拆 `src/styles.css` → `src/styles/{tokens,base,layout,components}.css`，
  落地 `contracts/design-tokens.md` 的全部双主题变量。
- 主题三态（system / dark / light）+ localStorage 持久化 + `index.html` 内联同步脚本防首帧闪白。
- 全量替换硬编码 hex 为 `var(--*)`，并用 CI 断言禁止回潮。
- 新增 47 个手写内联 SVG 图标（16×16 网格、`currentColor`、**零依赖**）。
- 新增 `src/components/ui/` 基础组件库（Button / Badge / Table / Modal / Tooltip 等 25 项）。

无 BREAKING：纯新增与样式重构，不改任何 API 与数据结构。

## Capabilities

### New Capabilities

无需新建 spec 文件——`specs/design-system/spec.md` 已于 2026-08-04 落地。

### Modified Capabilities

无 delta。本 change 实现的是 `specs/design-system/spec.md` REQ-001~005、REQ-010
与 `contracts/design-tokens.md` 全文，规格已先行就位，故 `.openspec.yaml` 设 `skip_specs: true`。

## Impact

| 面 | 影响 |
|----|------|
| 代码 | `src/styles.css` 删除并拆分；`index.html` 加内联主题脚本；新增 `src/components/icons/`、`src/components/ui/` |
| 现有组件 | 全部组件的 className 与内联 style 需改为引用 token；不改其逻辑与 props |
| 测试 | 新增 `src/styles/tokens.test.ts`（契约 §9 的 T1–T7 断言） |
| 依赖 | **0 新增**。图标、tooltip、拖拽全部手写（AUTOPILOT 禁令 C） |
| 性能 | CSS gzip < 16KB、图标集 < 12KB、主题切换 < 16ms |
