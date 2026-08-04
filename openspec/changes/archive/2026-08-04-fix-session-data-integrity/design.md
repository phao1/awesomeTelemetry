## Context

索引阶段与详情阶段的分工在 `project.md` §3.3 已定死：**不做无用功、不在请求路径上做重活、
传输量按需分级**。当前实现把「不解析正文」误读成了「不产出标题」，于是索引阶段快得毫无意义——
产出的 38 行里 34 行不可辨认。

T-03 已把 SQLite 类的**索引**按会话展开，但**详情**仍停留在文件级假设，故必空。

`server/proxy/` 的 MITM 实现在 M11 已完成并有测试，缺的只是 HTTP 路由接线。

## Goals / Non-Goals

**Goals:**
- 首屏列表每一行都可辨认（真实标题 + 真实事件数），且不违反索引阶段的性能预算
- OpenCode / CodeArts / CodeAgent2 的会话点开有内容
- 「解析失败」与「本来就空」在 API 层可区分
- Proxy / Frida 可以从 UI 启动

**Non-Goals:**
- 不做 D-003 的 JSONL 尾部增量读（优先级最低，等真实大文件成为瓶颈再说）
- 不动 Trae SQLCipher 解密链路（P-3 裁剪仍然有效，无 Windows 真机）
- 不改 schema，不做数据迁移

## Decisions

**D1 · 标题提取用「流式读到首条 user 消息即中断」，不走完整 adapter 管线。**
备选是「索引阶段跑完整 adapter」——被否，那等于取消索引/详情的分层，
最差会话会把 5ms 预算撑到秒级。中断式流读既拿得到标题也守得住预算。

**D2 · 注入内容用「前缀/标签黑名单」过滤，不做语义判断。**
实测注入块有稳定特征：`# AGENTS.md`、`<environment_context>`、`<system-reminder>`、
`<user_instructions>`。黑名单足够且零成本；语义判断既慢又不可测。

**D3 · 解析失败返回非 2xx + `SESSION_PARSE_FAILED`，不返回 200 + 空。**
这是前端能否区分四态的前提（`specs/design-system/spec.md` REQ-006）。
返回 200 + 空数组会让「空会话」和「后端坏了」长得一模一样，前端无从下手。

**D4 · proxy/frida 启动异步化，HTTP handler 立即返回「启动中」，就绪由 SSE 通知。**
遵守架构原则②。同步等待 MITM 起 CA + 监听端口会阻塞事件循环数百毫秒。

**D5 · 标题取不到时回落 `<provider> session · <本地时间>`，不回落文件名。**
文件名是当前问题本身；一个诚实的占位好过一个误导性的标识。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 流式读取在超大 JSONL（739MB 级）上仍可能慢 | 首条 user 消息通常在文件头部；设硬上限（读满 1MB 未命中即回落 D5） |
| 黑名单漏掉某个 provider 的注入格式 | 每个 provider 补一条真实结构 fixture 用例；漏了就补黑名单，不改测试 |
| OpenCode dialect 复用方（codearts/codeagent2）行为分叉 | 三者共用同一测试矩阵；注意 G4.4：`cache.read` 累积值用 max、reasoning 用 sum |
| proxy 异步启动后状态不一致 | `status` 增加 `starting` 中间态，前端按三态渲染 |
| 索引变慢拖累启动 | `perf:check` 硬门禁：劣化 > 20% 即回退 |
