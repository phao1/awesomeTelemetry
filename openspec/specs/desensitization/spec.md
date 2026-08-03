# Spec: Desensitization

> PII 脱敏引擎。源文件：`server/desensitization/`

## Purpose

对 scan 与 proxy 捕获的请求体、响应体、文件内容做正则脱敏，避免敏感数据入库或展示。

## Requirements

### REQ-001: 10 条内置规则
| # | id | 模式 | 替换 | 默认 |
|---|-----|------|------|------|
| 1 | api_key | `sk-[a-zA-Z0-9]{20,}` | `sk-***` | enabled |
| 2 | api_key_generic | `key-[a-zA-Z0-9]{20,}` | `key-***` | enabled |
| 3 | bearer_token | `Bearer\s+\S+` | `Bearer ***` | enabled |
| 4 | email | 邮箱 | `u***@e***.c***` | enabled |
| 5 | ip_address | IPv4 | `***.***.***.***` | enabled |
| 6 | file_path_win | `C:\...` | `C:\***` | enabled |
| 7 | file_path_unix | `/home\|/Users\|/root/...` | `/home/***` | enabled |
| 8 | aws_access_key | `AKIA[A-Z0-9]{16}` | `AKIA***` | enabled |
| 9 | aws_secret_key | 40 字符 base64 | `***` | **disabled**（误报多） |
| 10 | private_key | PEM 块 | `***PRIVATE KEY REDACTED***` | enabled |

### REQ-002: 顺序应用与 lastIndex 重置
`desensitize(text, opts)` SHALL 按顺序应用所有 enabled 规则。每个 global regex 在每次 replace 前 MUST 重置 `lastIndex`，否则会间歇性漏匹配。

### REQ-003: 对象脱敏
`desensitizeObject<T>(obj, opts, fields?)` SHALL 对指定字符串字段脱敏。

### REQ-004: 规则合并
`resolveRules(opts)` SHALL 合并内置默认与用户覆盖，返回完整规则集。

### REQ-005: 配置端点
`GET` / `PUT /api/desensitization/rules`，PUT MUST 原子写。

### REQ-006: raw 保留默认关闭
配置项 `keepRawBodies` 默认 `false`。为 true 时才写 `raw_request_body` / `raw_response_body`。

> v4 默认双存导致存储翻倍且明文入库，与脱敏目的相悖。v5 改为显式 opt-in，且 UI 上必须有明确提示。

### REQ-007: 性能约束
脱敏在 MITM 写库前的同步路径上执行，单次调用 MUST < 5ms @ 100KB 文本。超过时 MUST 跳过并记录，MUST NOT 阻塞请求转发。

## Gotchas
- G8.2：aws_secret_key 默认禁用
- global regex 必须每次 reset lastIndex
- G11.13（新）：脱敏在请求同步路径上，正则回溯爆炸会直接卡住代理。所有规则必须避免嵌套量词
