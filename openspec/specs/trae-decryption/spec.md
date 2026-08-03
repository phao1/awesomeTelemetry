# Spec: Trae CN Decryption

> Trae CN（字节跳动 AI IDE）三层加密体系的解密。这是本项目最耗时的逆向工程成果。
> 源文件：`local-sessions/trae.ts` + `src/adapters/trae.ts` + `scripts/trae-extract-key.py` + `scripts/frida-*.js` + `skills/decrypt-trae-cn.md`

> **v5 变更**：解密链路本身（逆向成果）完全保留，仅改变**调用方式**——见 §「v5 执行模型变更」。
> 原因：CPU profile 实测 4 次 `spawnSync` 合计阻塞事件循环 6,074ms，占 37.5% CPU。

## Purpose

Trae CN 用三层加密保护数据：SQLCipher 数据库 + TTNet 网络加密 + 客户端组装的 system prompt。本模块定义完整解密链路，让 scan 和 proxy 都能拿到 Trae 的会话数据。

## 加密体系总览

| 层级 | 加密方式 | 数据位置 | 解密方法 |
|------|---------|---------|---------|
| **数据库层** | SQLCipher (AES-256) | `%APPDATA%\Trae CN\ModularData\ai-agent\database.db` | 内存扫描提取密钥 + sqlcipher3 |
| **网络层** | TTNet body_encryptor_ (ECDH+AES-GCM) | sscronet.dll + ai_agent.dll (ring crate) | MITM 三件套（配置类）/ Frida 堆扫描（AI 聊天）|
| **应用层** | 服务端模板 + 客户端组装 | ai_agent.dll 内存 | Frida 堆内存扫描 |

## Requirements

### 第一层：SQLCipher 数据库解密

### REQ-001: 密钥提取
`scripts/trae-extract-key.py --save` SHALL 用 Windows API（`OpenProcess` + `ReadProcessMemory` + `VirtualQueryEx`）遍历 Trae 进程内存，搜索 `PRAGMA key = x'...'` 字符串模式，提取 64 字符 hex 密钥。

#### Scenario: 密钥保存
- **GIVEN** Trae CN 正在运行，密钥提取成功
- **WHEN** `--save` 执行
- **THEN** 密钥存到 `%APPDATA%\agent-observe\trae-db-key.txt`（64 字符 hex，无 `x''` 包装）

#### Scenario: 密钥格式变化（已知坑）
- **GIVEN** 某些 Trae 版本密钥格式变化，`PRAGMA key` 明文不在内存
- **THEN** 脚本失败，需用 Frida 在 ai_agent.dll 搜索 `PRAGMA key` 编译字符串（源码 `connection.rs`）

### REQ-002: DB 复制 + WAL checkpoint
解密查询前 SHALL：
1. 复制 `database.db` + `-wal` + `-shm` 到临时目录（原文件被 Trae 进程锁定）
2. 用 `PRAGMA key = "x'<hex>'"` 打开
3. **必须执行 `PRAGMA wal_checkpoint(FULL)`**，否则 WAL 中未 checkpoint 的数据不可见

#### Scenario: WAL 数据不可见
- **GIVEN** 用户在 Trae 里新发了消息，写入 WAL 未 checkpoint
- **WHEN** 复制 DB 后直接查询（无 checkpoint）
- **THEN** 新消息查不到（这是真实踩过的 bug）

### REQ-003: DB schema 查询
scanner SHALL 查询并 join 多张表：会话（chat_session）、轮次（chat_turn）、消息（chat_message + chat_message_general）、任务（chat_message_task）、历史（history_v2）、服务端历史（server_history_info）、工具调用（toolcall）。

### REQ-004: 时间戳秒级转毫秒
所有 `created_at`/`updated_at` 字段是**秒级** Unix 时间戳。SHALL 在传给 `new Date()` 前 `× 1000`。

#### Scenario: 秒级时间戳
- **GIVEN** `chat_session.created_at = 1753300000`
- **WHEN** 直接 `new Date(1753300000)`
- **THEN** 得到 1970 年日期（错误）；必须 `new Date(1753300000 * 1000)`

### REQ-005: Token 数据双表分布
token 数据分布在两张表：
- `history_v2.token_usage`（INTEGER）= 消息大小 token 数（**不是** output token）
- `server_history_info`：`token_usage` = INPUT/prompt tokens，`item_token_usage` = OUTPUT/completion tokens
- 通过 `agent_run_id` 关联到 `history_v2`
- `history_v2.content_source` 区分行类型：`llm_default`=LLM响应，`user_input`=用户消息，`Read`/`Glob`/`Write`等=工具结果
- `extra_info.input_token`（messages JSON 的 raw_messages 内）是增量 input token（很小，10-600），非总 input

#### Scenario: token_usage /2 校准
- **GIVEN** Trae 面板显示 token 和 DB `server_history_info.token_usage` 对不上
- **WHEN** adapter 处理
- **THEN** `token_usage / 2` 校准（双向累计）

#### Scenario: 非 LLM 行 token_usage
- **GIVEN** 非 LLM 行有纯数字 `token_usage`
- **WHEN** adapter 处理
- **THEN** 跳过（是 message size，已计入 LLM input context）；只有 `content_source === 'llm_default'` 计入 outputTokens

### REQ-006: Python bridge 集成
`local-sessions/trae.ts` SHALL 通过内嵌 Python bridge 脚本调用 sqlcipher3，复制 DB 到临时目录后解密查询，结果以 JSON 返回 Node 处理。

### REQ-007: Windows Python 编码
通过 `execFileSync` 调用 Python 时 SHALL 在 env 设 `PYTHONIOENCODING=utf-8`，避免 cp936/gbk 中文乱码。

### REQ-008: 30 秒轮询（非文件监视）
Trae DB 用 WAL 模式，chokidar 文件监视检测不到变更。SHALL 用 30 秒定时轮询。

#### Scenario: 轮询也需要指纹门禁
- **GIVEN** 30 秒轮询触发
- **WHEN** 判断是否需要重新解密
- **THEN** MUST 计算 `database.db` **与 `database.db-wal` 两个文件**的指纹并拼接
- **AND** 仅看主 DB 文件会永远判定为未变更（WAL 模式下主文件 mtime 不变），导致每轮都白白解密一次

---

## v5 执行模型变更（性能，非逆向）

> 以下三条不改变任何解密逻辑，只改变它被调用的时机与方式。
> 依据：`PERF-DIAGNOSIS.md` Step 5 CPU profile。

### REQ-008a: 禁止 spawnSync
Python bridge MUST 用 `spawn` + Promise 封装，MUST NOT 用 `spawnSync` / `execFileSync`。

`PYTHONIOENCODING=utf-8` 的设置在异步版本中同样必需（见 REQ-007）。

```ts
export function runPythonBridge(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [script, ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    let out = '', err = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += String(d); });
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolve(out) : reject(new Error(`trae bridge exit ${code}: ${err.slice(0, 500)}`)));
  });
}
```

#### Scenario: 单次 spawnSync 的代价
- **GIVEN** 一次 `spawnSync` 调用 Python 解密
- **THEN** 事件循环被阻塞 1,070–2,251ms（实测四次分别为 2,250.8 / 1,919.5 / 1,070.1 / 834.3ms）
- **AND** 期间所有 HTTP 请求排队，用户观感为"整个应用卡死"

### REQ-008b: 解密结果缓存
`readTraeSessions(dbPath)` MUST 缓存解密结果，缓存键为主 DB 与 `-wal` 的拼接指纹，TTL 30s（与轮询周期对齐）。指纹未变且未超 TTL 时 MUST NOT spawn 任何进程。

### REQ-008c: 解密不得出现在请求路径
`GET /api/sessions/:key` 处理 Trae 会话时 MUST NOT 触发解密。

#### Scenario: 详情尚未就绪
- **GIVEN** 用户点开一个 Trae 会话，但解密结果尚不可用
- **THEN** MUST 立即返回已有索引数据 + `pending: true`
- **AND** 解密由 30s 轮询在后台完成，完成后经 SSE `sessions_changed` 通知前端自动重取
- **AND** 前端 MUST NOT 轮询等待

### REQ-008d: 密钥缺失的显式报错
scanner 在密钥不存在时 MUST 返回 HTTP 412 与错误码 `TRAE_KEY_MISSING`，提示信息含提取命令 `python scripts/trae-extract-key.py --save`。MUST NOT 静默跳过 Trae provider。

### REQ-009: 重复 session 检测
Trae 会为同一任务创建多个 `chat_session` 记录（不同 `session_id` 但 `session_title` 相同，创建时间相差数秒）。这是 Trae 自身行为，observability 如实反映，每个 session_id 生成独立 sessionKey。

### REQ-010: message_id vs session_id
两者都是 24 字符 hex ObjectId，仅看格式无法区分。排查方法：若 ID 在 `chat_session` 表查不到，用 `SELECT session_id FROM chat_message WHERE message_id=?` 反查。

---

### 第二层：TTNet 网络流量解密

### REQ-011: 进程架构
系统 SHALL 理解 Trae 的进程架构：
- 主进程（Trae CN.exe，Electron）— CDP 可连
- ai_agent 进程（ai_agent.dll，Rust 233MB）— **明文在此**，AI 引擎
- network service 进程（sscronet.dll + aha_net.dll）— 网络层，加密在此
- 渲染进程 — CDP 可连但无 AI 请求

### REQ-012: MITM 三件套（配置类请求）
拦截配置类请求需三步（缺一不可）：
1. **main.js 补丁** — 绕过 `isBusinessUser` 守护：`get isBusinessUser(){return !0}`
2. **Windows 系统代理**（sscronet 读注册表，不读环境变量）：`reg add ... ProxyServer=127.0.0.1:7779 /v ProxyEnable=1`
3. **CA 证书装到用户级 root store**：`certutil -addstore -user root proxy-ca-cert.pem`

#### Scenario: 必须重启 Trae
- **GIVEN** 设了系统代理 + 装了 CA
- **WHEN** 不重启 Trae
- **THEN** sscronet 不生效（只在 Cronet 引擎创建时读配置）

#### Scenario: 可读性区分
- **GIVEN** 配置类请求（batch_get_detail_param 等）
- **THEN** 请求体/响应体均明文 ✅
- **GIVEN** AI 聊天请求（/api/agent/v3/llm_utils_chat）
- **THEN** 响应体明文 ✅，**请求体加密** ❌（TTNet body_encryptor_）

### REQ-013: DLL Patch（部分有效）
可直接修改 sscronet.dll 文件禁用加密决策函数。**两个 DLL 必须分别 patch**（代码不同）：
- 主目录 `<install>/sscronet.dll`（9,093,520 字节）
- ai-agent 子目录 `<install>/resources/app/modules/ai-agent/sscronet.dll`（9,081,232 字节）

patch 点包括：加密决策函数、smbyttnet header、body_encryptor_ 检查。

#### Scenario: patch 局限性
- **GIVEN** sscronet.dll 已 patch，smbyttnet header 消失
- **WHEN** 检查 AI 聊天请求体
- **THEN** **请求体仍加密**（加密实际在 ai_agent.dll 的 ring crate 0.17.8，不在 sscronet.dll）

### REQ-014: Frida 堆内存扫描（推荐方案）
AI 聊天明文 JSON 存在于 ai_agent.dll 进程堆内存中（加密之前）。SHALL：
1. `discoverFridaTarget()` — tasklist 找 Trae CN.exe PID，逐个 Frida 探测 `ai_agent.dll` 是否加载
2. spawn `frida -p <PID> -l frida-chat-monitor-v2.js`
3. 扫描 `"raw_messages"` 字节模式（比 `"messages"` 精准），dump 周围 32KB
4. Frida 输出 hex（`[HEX]` 标记），Node 端 `Buffer.from(bytes).toString('utf8')` 解码
5. 存 `frida_captures` 表，emit `frida_capture` 事件

#### Scenario: ai_agent.dll 按需加载
- **GIVEN** Trae 刚启动，用户未用 AI 聊天
- **THEN** ai_agent.dll 未加载，discover 找不到；用户首次聊天后才出现

#### Scenario: Rust heap 碎片化
- **GIVEN** 一次性堆扫描
- **WHEN** 大 JSON（16KB+）被堆中二进制数据损坏
- **THEN** JSON.parse 失败；用 monitor 模式（持续监听）比 scan 更可靠

### REQ-015: UTF-16LE 处理
Frida 抓 Electron 应用字符串要处理 UTF-16LE 编码。v2 脚本输出原始 hex 让 Node 端 UTF-8 解码，避免 Frida 侧手动解码的 3 字节中文字符偏移计算错误（"锟斤拷"乱码）。

### REQ-016: CDP 对 Trae 无效
CDP 连接只能看到 Electron 主进程请求，sscronet 是独立原生 DLL，CDP 捕获不到 AI 聊天请求（已验证 0 事件）。CDP 仅对标准 Electron 应用有效。

### REQ-017: 无效方案清单（避免重试）
以下方案已验证全部 0 事件，**不要重试**：
- CDP Network 域
- EVP_AEAD_CTX_seal hook（RVA 0x7b8d9b0 及 6 个候选函数）
- 所有 I/O 层 hook（send/WSASend/WSARecv/NtWriteFile/ReadFile/ConnectNamedPipe/CreateFileW）
- Cronet 导出 API hook
- WINHTTP hook
- custom_model.base_url 注入（华为 HIS 透明代理拦截返回 504）
- `--proxy-server` / `--ignore-certificate-errors` / `NODE_EXTRA_CA_CERTS`（只影响 Electron，不影响 sscronet）

---

### 第三层：System Prompt 捕获

### REQ-018: 三层组装架构
system prompt 是"服务端提供模板 + 客户端组装"：
- **第1层**：messages[0] role=system（~8721 chars，静态，服务端模板缓存，键名 `master_agent`）
- **第2层**：tools[]（16 个工具定义，随 agent_type 变化）
- **第3层**：user message `<system-reminder>` 动态上下文（7 类组件：终端状态/工作区规则/环境上下文/important-instruction-reminders/Skill检查/语言设置/用户输入）

`role:system` 在客户端 0 次出现在网络请求中（组装后变为 user message 的一部分）。

### REQ-019: capture-monitor.py 最佳捕获方法
1. Frida attach 到 ai_agent.dll 宿主进程
2. 扫描 rw- 内存块建立基线
3. 每 2 秒检查新出现/变化的内存块
4. **用户在 Trae IDE 发消息** → ai_agent.dll 组装完整 API 请求到内存
5. 检测到包含 prompt 标记的新块 → 自动捕获
6. 提取 system prompt（从 "You are" 到 `"role":"user"` 之前）

#### Scenario: 必须先启动监控
- **GIVEN** 监控脚本未启动
- **WHEN** 用户发消息
- **THEN** 内存中曾有的完整请求已被覆盖，无法捕获；**必须先启动监控再发消息**

### REQ-020: 大 JSON partial 重建
16KB+ 完整聊天 JSON 常被堆中二进制数据损坏。完整 system prompt 提取需结合：
1. Frida 捕获的注入结构（7 类 system-reminder 组件顺序和格式）
2. 从 partial capture 中提取 AGENTS.md 路径
3. 读取磁盘上的实际文件重建

### REQ-021: Trae CLI 替代
`trae-cli --print --output-format json` 可直接获取完整 system prompt（CLI 版是 solo_coder agent 的精简版，与 IDE 不同）。CLI 数据目录 `%LOCALAPPDATA%\trae-cli\`。

---

## Gotchas（本模块坑最深，逐条必读）

### 数据库层
- **G6.1**：SQLCipher key 需 python 提取，scanner 要先检查 key 存在
- **WAL checkpoint**：复制 DB 后必须 `PRAGMA wal_checkpoint(FULL)`，否则新消息不可见（真实踩过）
- **秒级时间戳**：`created_at` 等是秒级，必须 ×1000，否则显示 1970 年
- **Python 编码**：Windows `execFileSync` 调 Python 必须设 `PYTHONIOENCODING=utf-8`
- **密钥格式变化**：2026-07-23 发现某些版本 `PRAGMA key` 明文不在内存，需 Frida 搜 `connection.rs` 编译字符串
- **G5.2**：WAL 模式文件监视不可靠，必须 30s 轮询
- **重复 session**：Trae 自身会为同任务创建多个 chat_session，不是 observability bug
- **message_id 与 session_id 格式相同**：都是 24 字符 hex ObjectId，排查时反查

### Token 计算（最易错）
- **G4.2**：`server_history_info.token_usage` 需 /2 校准
- **G4.3**：非 LLM 行的纯数字 `token_usage` 是 message size，跳过；只有 `content_source === 'llm_default'` 计入 outputTokens
- **token 双表分布**：`history_v2.token_usage` 是消息大小非 output token；真实 input/output 在 `server_history_info`
- **`extra_info.input_token` 是增量**（10-600），非总 input

### 网络层
- **G6.2**：TTNet body 无法 MITM 解密（加密在 ai_agent.dll ring crate，不在 sscronet）
- **MITM 三件套缺一不可**：main.js 补丁 + Windows 注册表代理 + CA 证书
- **必须重启 Trae**：sscronet 只在 Cronet 引擎创建时读代理配置和信任根
- **sscronet 读注册表不读环境变量**：`HTTPS_PROXY`/`HTTP_PROXY` 无效
- **两个 sscronet.dll 代码不同**：patch 时必须分别处理，RVA 偏移不同
- **smbyttnet header 与 body 加密是独立代码路径**：patch 让 header 消失但 body 仍加密
- **启动陷阱**：用 `--proxy-server` 启动 Trae 时若 MITM 服务没运行，登录也会失败；必须先不带代理启动登录

### Frida 层
- **G6.3**：Rust heap 碎片化，monitor 模式比 scan 可靠
- **G6.4**：Electron/UTF-16LE 特殊处理；v2 脚本输出 hex 让 Node 端解码
- **ai_agent.dll 按需加载**：用户首次 AI 聊天才出现，PID 随重启变化
- **Frida 注入被拒**：Trae 以管理员运行时需管理员权限 Frida
- **G6.5**：CDP 对 Trae 无效（不要重试）
- **所有 I/O hook 0 事件**：不要重试 send/WSASend/NtWriteFile 等
- **大 JSON partial**：16KB+ JSON 常被堆二进制损坏，需结合磁盘文件重建

### 性能（v5 新增）
- **G11.6**：`spawnSync` 在单线程 Node 里是绝对禁区，一次调用吃掉 1.5–2.3 秒事件循环
- **G11.15**：Trae 的变更检测指纹必须覆盖 `-wal` 文件，只看主 DB 永远判定为未变更
- **G11.16**：解密永远不要出现在 HTTP 请求处理路径上；未就绪就返回 `pending: true`，让 SSE 去补

### 华为网络环境
- **custom_model.base_url 注入被 HIS 拦截**：返回 504，华为企业网络下不可行
- **Frida 方法不受 HIS 影响**：是华为网络下唯一可行方案
- **G3.1**：dev URL 必须 127.0.0.1

### System Prompt
- **必须先启动监控再发消息**：否则内存中完整请求已被覆盖
- **role:system 客户端 0 次出现**：组装后变 user message 的一部分
- **CLI ≠ IDE**：CLI 版 prompt 是精简版

## 文件清单

| 文件 | 用途 |
|------|------|
| `scripts/trae-extract-key.py` | SQLCipher 密钥提取（Windows API 内存扫描）|
| `local-sessions/trae.ts` | Trae DB scanner（Python bridge + sqlcipher3）|
| `src/adapters/trae.ts` | Trae 数据适配器（token 校准 + phase 映射）|
| `scripts/frida-chat-monitor-v2.js` | Frida 堆内存扫描（主力，hex 输出）|
| `scripts/frida-check-module.js` | 检测进程是否加载 ai_agent.dll |
| `scripts/frida-capture-full.js` | Frida 完整请求捕获 |
| `scripts/frida-capture-plaintext.js` | sscronet DLL patch 脚本 |
| `scripts/capture-proxy.mjs` | HTTP 捕获代理（Custom Model 方式，华为网络下失效）|
| `skills/decrypt-trae-cn.md` | 完整三层解密 skill（团队复用）|
| `skills/capture-agent-system-prompt.md` | System Prompt 捕获详细指南 |
