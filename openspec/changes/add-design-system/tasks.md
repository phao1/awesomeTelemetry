> 详细验收标准见 `UI-TASKS.md` T-13 / T-14。数值一律以 `contracts/design-tokens.md` 为准。
> 严格串行：token → 图标 → 组件（design.md D5）。

## 1. Token 层与主题机制（T-13，spec REQ-001/002/003）

- [ ] 1.1 新建 `src/styles/tokens.css`，落地契约 §2–§7 两套主题全部变量（键集合必须完全一致）
- [ ] 1.2 拆分 `src/styles.css` → `base.css` / `layout.css` / `components.css`，`main.tsx` 按 tokens→base→layout→components 顺序引入
- [ ] 1.3 `index.html` 加**内联同步**主题脚本，首帧 CSS 前设置 `data-theme`（D2 / G-DS-2）
- [ ] 1.4 实现主题三态切换 + localStorage `agent-observability.theme` + `matchMedia` change 监听
- [ ] 1.5 全量替换现有硬编码 hex 为 `var(--*)`
- [ ] 1.6 写 `src/styles/tokens.test.ts`：契约 §9 的 **T1**（键集合相等）、**T2**（无字面量颜色）、**T3**（无字面量间距）
- [ ] 1.7 写对比度断言 **T4**（WCAG 相对亮度，自己算不引库）与 **T5**（6 phase 色两两 ΔE > 15）
- [ ] 1.8 验收：切主题不重载、不闪白；刷新后主题保持；CSS gzip < 16KB

## 2. 图标集（T-14，spec REQ-004）

- [ ] 2.1 建 `src/components/icons/index.tsx` 与共享 `<Icon>` 壳（`size` / `className` / `label`）
- [ ] 2.2 实现导航/视图 8 个：Sessions / Agents / Compare / Proxy / Frida / Sidebar / Panel / Command
- [ ] 2.3 实现 phase 6 个：Understand / Plan / Implement / Debug / Verify / Report
- [ ] 2.4 实现状态 6 个：Success / Error / Running / Pending / Cancelled / Warning
- [ ] 2.5 实现事件类型 6 个：Message / Tool / File / Terminal / Thought / System
- [ ] 2.6 实现指标 4 个：Speed / Accuracy / Stability / Cost
- [ ] 2.7 实现操作 12 个：Search / Filter / Refresh / Copy / Download / ExternalLink / Trash / Close / ChevronRight / ChevronDown / Kebab / Plus
- [ ] 2.8 实现其它 5 个：Gear / Globe / Sun / Moon / DeviceDesktop（三个主题图标各自独立，不复用路径）
- [ ] 2.9 写断言 **T6**（导出名集合与清单严格相等，无多无少 = 47）与 **T7**（含 `viewBox="0 0 16 16"`、无 `fill="#"`/`stroke="#"`）
- [ ] 2.10 验收：全套未压缩 < 12KB

## 3. 基础组件库（spec REQ-005）

- [ ] 3.1 Button / IconButton（variant × size，命中区 ≥ 24×24）
- [ ] 3.2 Badge / StatusBadge / PhaseBadge / ProviderBadge（字母章，色见契约 §2.6）
- [ ] 3.3 Field / Input / Select / SearchInput（与 Button 等高，`/` 聚焦）
- [ ] 3.4 Tabs（underline / pill）/ Table（compact 密度、sticky 表头、可排序）
- [ ] 3.5 Tooltip / Popover / DropdownMenu（Esc 关闭、点外关闭、焦点回归，手写不引库）
- [ ] 3.6 Modal / Drawer（焦点陷阱）
- [ ] 3.7 Kbd / MetricCard / BarMeter / Sparkline（内联 SVG）
- [ ] 3.8 SplitPane（拖拽 + 宽度持久化）
- [ ] 3.9 验收：所有可交互元素有 `:focus-visible` 焦点环；`prefers-reduced-motion` 下动画归零

## 4. 阶段收口

- [ ] 4.1 `npm run typecheck && npm run test && npm run lint` 全绿
- [ ] 4.2 契约 §9 的 T1–T7 七条断言全部在 CI 中执行且通过
- [ ] 4.3 更新 `PROGRESS.md`
- [ ] 4.4 `openspec archive add-design-system`
