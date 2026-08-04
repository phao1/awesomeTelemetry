> 详细验收标准见 `UI-TASKS.md` T-10 / T-11 / T-12。
> 每完成一个任务组：`npm run typecheck && npm run test && npm run lint` 全绿 → 一个 commit。

## 1. 索引阶段真实标题与事件数（T-10，spec REQ-021）

- [x] 1.1 写测试：含 `# AGENTS.md` / `<environment_context>` / `<system-reminder>` 注入块的真实结构 JSONL fixture，断言提取到的是用户消息而非注入内容
- [x] 1.2 写测试：无 user 消息的空会话，断言回落为 `<provider> session · <时间>`，且不含 `.jsonl`
- [x] 1.3 实现 JSONL 类流式提取：读到首条 user 消息即中断，硬上限 1MB
- [x] 1.4 实现注入内容黑名单过滤（D2），标题截断 120 字符
- [x] 1.5 实现 SQLite 类：取会话行自带 title，为空则取首条 user message；`COUNT(*)` 取事件数
- [x] 1.6 验收：删 `agent-observe-data/` 重启，`GET /api/sessions?limit=50` 断言无一条 title 以 `.jsonl`/`.db` 结尾、无一条以 `rollout-` 开头、`eventCount` 均 > 0
- [x] 1.7 验收：`npm run perf:check` 单 JSONL < 5ms、单 SQLite 库 < 50ms、总体无劣化 > 20%

## 2. SQLite 类 provider 详情解析（T-11，spec REQ-022）

- [x] 2.1 写测试：构造含 3 个会话的临时 SQLite（真实 DDL，**不 mock** better-sqlite3），逐个断言 `events.length > 0`
- [x] 2.2 写测试：损坏的库返回非 2xx + `SESSION_PARSE_FAILED`
- [x] 2.3 实现：按「db 路径 + 行内 session id」定位会话并解析事件
- [x] 2.4 复用 opencode adapter 的 dialect 参数覆盖 codearts / codeagent2（`project.md` §7）
- [x] 2.5 核对 G4.4：`cache.read` 累积值用 max、reasoning 用 sum
- [x] 2.6 实现错误码路径（D3），登记进 `contracts/api.md` §0.4 错误码全集
- [x] 2.7 验收：`GET /api/sessions/opencode-<真实key>` 与 `codearts-<真实key>` 均 `events.length > 0` 且 title 非空

## 3. Proxy / Frida 控制路由（T-12，contracts/api.md §4 §5）

- [x] 3.1 写测试：start → `status.running=true` → 重复 start 得 409 `PROXY_ALREADY_RUNNING` → stop → 重复 stop 得 409 `PROXY_NOT_RUNNING`
- [x] 3.2 实现 `POST /api/proxy/start`（body `{ port?: number }`）与 `POST /api/proxy/stop`
- [x] 3.3 实现 `POST /api/frida/start`（body `{ pid?: number }`，省略则自动发现，失败 409 `FRIDA_TARGET_NOT_FOUND`）与 `POST /api/frida/stop`
- [x] 3.4 启动异步化（D4）：handler 立即返回，`status` 增加 `starting` 态，就绪由 SSE 通知
- [x] 3.5 验收：`curl -X POST localhost:4213/api/proxy/start -d '{"port":8888}'` 返回 2xx，`GET /api/proxy/status` 显示 running

## 4. 阶段收口

- [x] 4.1 `npm run typecheck && npm run test && npm run lint` 全绿
- [x] 4.2 `npm run perf:check` 结果追加到 `PERF-BASELINE.md`
- [x] 4.3 更新 `PROGRESS.md`
- [x] 4.4 输出实机验证报告：贴 `GET /api/sessions?limit=10` 的真实 title 列表、opencode/codearts 的 events 数量、`POST /api/proxy/start` 的真实响应
- [x] 4.5 `openspec archive fix-session-data-integrity`
