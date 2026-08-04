> 详细验收标准见 `UI-TASKS.md` T-15 ~ T-22。
> 前置：`fix-session-data-integrity` 与 `add-design-system` 均已 archive。
> **每个视图一个 commit**（design.md D6）。

## 1. 共享会话 store，修复对比视图（T-15，spec REQ-015）

- [x] 1.1 写测试：渲染 App，加载 3 条会话，切到 compare 视图，断言两个选择器各有 3 个选项
- [x] 1.2 会话索引提到 `App.tsx` 单一持有，删除 `SampleRail` 私有 `sessions` state
- [x] 1.3 `SessionList` 改为受控组件（props 传入 items / 分页回调）
- [x] 1.4 SSE patch、滚动分页、对比选择器全部读同一份（G7.6：不得有第二份会话数组）
- [ ] 1.5 验收：启动后直接点 compare，两个选择器已填充，选中两条能出结果

## 2. 四态与消灭空 catch（T-16，design-system REQ-006 + frontend REQ-022）

- [x] 2.1 实现 `Skeleton` / `EmptyState` / `ErrorState` / `Toast` 四个组件
- [x] 2.2 按 `specs/frontend/spec.md` REQ-022 的 7 行表格逐条改造（SessionList / selectSession / EventInspector / AgentOverview / CompareBoard / Proxy+Frida / SettingsModal）
- [x] 2.3 所有 `catch` 块：设 error 态 + `console.error` 原始错误，**不得为空、不得只含注释**
- [x] 2.4 加 CI 断言：`src/**/*.tsx` 中不存在空 `catch {}` 或只含注释的 catch
- [x] 2.5 i18n 补 `state.*` 前缀文案（zh + en 同时加，`i18n.test.ts` 有键对齐断言）
- [ ] 2.6 验收：`kill` 掉后端后点击任意会话，5 秒内出现错误码 + 重试按钮，状态栏变断开
- [ ] 2.7 验收：loading 骨架行高 == 真实行高，数据到达时 CLS = 0

## 3. AppShell + 状态栏 + 布局持久化（T-17，spec REQ-015/023/026）

- [x] 3.1 全局头 48px + underline tabs 40px + 三栏 + 状态栏 28px
- [x] 3.2 左右栏拖拽调宽（rail 260–480、inspector 280–900）与折叠
- [x] 3.3 状态栏：连接态（`aria-live`）/ 会话与事件计数 / 扫描态 / 库大小 / 数据源标识
- [x] 3.4 布局偏好持久化（REQ-026 的 7 个键），读取时做范围校验
- [ ] 3.5 验收：状态栏**不轮询** `/api/health`；localStorage 塞脏值不崩溃

## 4. 会话列表行（T-18，spec REQ-016）

- [x] 4.1 44px 双行密排：状态点 + 标题 / ProviderBadge + 相对时间 + events + tokens
- [x] 4.2 选中态左侧 2px 竖条；hover 无过渡（G-DS-4）
- [x] 4.3 过滤区：SearchInput + provider 多选 + status 多选
- [ ] 4.4 验收：500 条会话滚动掉帧 < 5%；行高恒为 `--row-lg`（G-DS-1）

## 5. 会话详情主区（T-19，spec REQ-017）

- [ ] 5.1 SessionHeaderCard：provider + 标题 + 状态 + 溢出菜单 + meta 行
- [ ] 5.2 四维指标条（快/准/稳/省），`null` 显示 `—` 并加 tooltip，**不得用 `0` 冒充**
- [ ] 5.3 **PhaseRibbon**：按时间占比铺满的色带，悬停出 phase/时长/事件数，点击等价于只选该 phase
- [ ] 5.4 PhaseTiles：6 个 tile 带计数徽标 + 全选/反选
- [ ] 5.5 TraceTimeline：时间比例条（真实位置与时长）+ 树形缩进（最多 3 级，可折叠）+ phase 图标与色
- [ ] 5.6 零时长事件渲染为最小 2px 竖线
- [ ] 5.7 EventInspector 分页签（Summary/Input/Output/Raw/Tokens），**Raw 切到才请求**
- [ ] 5.8 修 P1-6：Transcript 改分页拉取 + 弹层内虚拟滚动，**不得一次 `mode=full`**
- [ ] 5.9 验收：9,590 event 会话 DOM < 500、首绘 < 200ms

## 6. Agent 概览（T-20，spec REQ-018）

- [ ] 6.1 顶部 4 张 KPI 卡（快/准/稳/省 加权聚合）
- [ ] 6.2 可排序对比表 + 内联 BarMeter / Sparkline，数值列右对齐 mono
- [ ] 6.3 `null` 与 `0` 视觉可区分
- [ ] 6.4 行展开列出该 provider 最近 10 条会话，点击跳转并选中
- [ ] 6.5 验收：切到该视图网络请求数 **== 1**；展开行不产生新请求（G11.9）

## 7. 对比视图（T-21，spec REQ-019）

- [ ] 7.1 搜索式会话选择器（Popover + 搜索，**不用原生 select**）
- [ ] 7.2 **结论条**：一句话给出「谁快多少 / 谁省多少」
- [ ] 7.3 四维双条对比，按「谁更优」着色；L/R 除颜色外必须有字母标记
- [ ] 7.4 PhaseRibbon 上下对照（共享同一时间比例尺）+ 时间线并排
- [ ] 7.5 未选择时给 EmptyState 引导，不是两个空下拉

## 8. Proxy / Frida 视图（T-22，spec REQ-020/021）

- [ ] 8.1 Proxy 控制条：状态 / 启动停止 / 端口 / CA 证书下载 / 请求计数与清空
- [ ] 8.2 停止与清空是破坏性操作，需二次确认（design-system REQ-007）
- [ ] 8.3 请求列表密排表 + 方法色标 + 状态码语义色 + 过滤
- [ ] 8.4 详情抽屉：Request / Response / Headers / Timing 分页签，脱敏字段标注
- [ ] 8.5 Frida 控制条 + 捕获列表 + 前置条件未满足时说清缺什么怎么装
- [ ] 8.6 验收：未启动时空态含启动按钮与 CA 安装提示，不是一句「暂无数据」

## 9. 阶段收口

- [ ] 9.1 `npm run typecheck && npm run test && npm run lint` 全绿
- [ ] 9.2 五个视图逐一手工走查，无 console error
- [ ] 9.3 更新 `PROGRESS.md`
- [ ] 9.4 `openspec archive redesign-frontend-views`
