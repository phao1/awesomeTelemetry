## Context

`contracts/design-tokens.md` 已把色板、字号、间距、动效、对比度定死，本 change 只是落地。
唯一的自由度在**组织方式**：CSS 变量 vs CSS-in-JS、图标怎么打包、组件库多薄。

硬约束：零新依赖（`project.md` §2 只有 4 个 runtime 依赖，刻意保持）。
这排除了 Tailwind / styled-components / lucide / radix 等一切现成方案。

## Goals / Non-Goals

**Goals:**
- token 可被主题覆盖，且「回潮成硬编码」在 CI 里会红
- 首帧不闪白
- 47 个图标 + 25 个组件，全部手写、可 tree-shake、总量受控

**Non-Goals:**
- 不做组件的 Storybook / 文档站
- 不做设计稿还原到像素级——契约给的是 token 不是稿
- 不在本 change 改任何视图布局（那是 `redesign-frontend-views`）

## Decisions

**D1 · 纯 CSS 变量 + 普通 class，不引任何 CSS 方案。**
备选 CSS Modules——被否，Vite 默认支持但会让 class 名不可预测，
而契约 §9 的 T2/T3 断言需要静态扫描 CSS 文件。普通 CSS + 变量最可测。

**D2 · 主题脚本内联在 `index.html` 的 `<head>`，不进 bundle。**
进 bundle 就晚于首帧 CSS，必闪（G-DS-2）。代价是 `index.html` 里有一小段裸 JS，
可接受——这是所有暗色模式方案的标准做法。

**D3 · 图标为独立命名导出，不做 `<Icon name="x">` 字符串映射。**
字符串映射会把全部 47 个图标打进任何引用它的 chunk。
命名导出可 tree-shake，且 T6 断言能静态校验导出名集合。

**D4 · 组件库只做「无业务逻辑的纯展示件」。**
数据获取、四态判断留在视图层。这样组件可测、可复用，
且不会出现「Button 里藏了个 fetch」这类耦合。

**D5 · 先 token 后图标后组件，严格串行。**
组件依赖 token 和图标；并行做会产生大量返工。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 手写 47 个图标耗时且易走形 | 统一 16×16 网格 + 共享 `<Icon>` 壳；T7 断言校验 viewBox 与无硬编码色 |
| 全量替换硬编码 hex 可能漏改 | T2/T3 断言是全量静态扫描，漏改必红 |
| 对比度达不到契约 §2.7 | T4 断言用 WCAG 相对亮度公式计算（不引库）；不达标就调 token 值，不改断言 |
| 6 个 phase 色区分度不足（cyan/blue 相近） | T5 断言两两 ΔE > 15；且颜色永不单独承载语义，必配图标 |
| CSS 体积超预算 | 预算 gzip < 16KB 进 CI；超了先砍未使用的组件变体 |
