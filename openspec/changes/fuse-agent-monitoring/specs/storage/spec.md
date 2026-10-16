## MODIFIED Requirements

### Requirement: REQ-018: Evidence-backed capture association
系统 SHALL 保留所有原生身份、值、scope、定位和用户决定，差分摄取不得重写原始会话。v17原生匹配索引仅覆盖session/scope NULL；其他身份仍经source索引分页读取。v16→v17只原子重建该索引并更新版本，失败保留旧索引/版本/数据；当前版本重复启动不得重建。精确原生键 SHALL 驱动索引SEARCH，ANALYZE后的微型库也不得扫描整个身份索引。

#### Scenario: Large admitted capture near a pinned WAL watermark
- **WHEN** 长scope或2046个工具身份的实际生产代理/worker请求，在32候选关联和接近8,000,000字节WAL准入水位的真实固定读者下被正常解析
- **THEN** 所有工具身份、原文字节/摘要及scan行保留，解析不以result_limit降级规避，WAL<20,000,000、DB+WAL<200,000,000字节且非空事件循环p99<50ms；不冒充任意输入/共享写入者/物理磁盘满或真机Agent的全面证明

#### Scenario: Index cutover or metadata version write fails
- **WHEN** v16→v17切换期间SQLite版本写入失败
- **THEN** 索引和版本一起回滚，原生身份和会话不变，解除故障后可安全重试；重复v17启动不改变索引rootpage

### Requirement: REQ-014: System prompt association
Time-window longest-prompt and capture-run predecessor lookups SHALL be treated as candidate evidence only. A linked Trace SHALL inspect a selected request's own prompt without copying nearby prompts into a native session. Automatic context comparison SHALL require one direct/confirmed session owner for both target and base, the same supported request format and nearest eligible observed UTC capture order; legacy parsed IDs/run/model/time alone MUST NOT authorize pairing. Manual selection SHALL remain available without creating an association.

#### Scenario: Concurrent capture contexts
- **WHEN** two sessions share a gateway/model/run and an unrelated request has the longest prompt
- **THEN** automatic comparison uses only eligible requests from the unique linked session, preserves request-specific prompt provenance and never fills native session context from the unrelated prompt

#### Scenario: Ambiguous membership
- **WHEN** a target has candidate-only or multiple accepted session memberships
- **THEN** automatic context pairing is unavailable, but the user may explicitly compare two chosen requests labelled manual

### Requirement: REQ-017: Data retention
系统 SHALL 将原文流式保存在独立本地文件中，默认总预算10GB、每方向100MiB，均可配置。默认不自动过期或删除原文；到达容量上限 SHALL 停止新增收集并明确提示，保留已有证据。SQLite元数据与预览遵守独立NFR预算。用户显式删除或显式启用保留期时才可清理；不得为腾空间删除scan数据。分析限额不影响原文下载。

采集元数据 SHALL 通过同DB有界准入检查实际数据库/WAL长度，高水位拒绝新日志/最终提交/恢复插入，保留已有日志和原文、不影响转发、不伪造保存成功。checkpoint忙时不得阻塞等待；独立容量诊断不触发checkpoint或恢复，已有记录仍可读取和明确清理。此保护不代表其他scan/外部写入者或最坏大小事务已通过长期预算验收。

#### Scenario: Reader pins WAL during ongoing capture
- **WHEN** 真实读取事务阻止checkpoint并达到WAL准入水位
- **THEN** 立即拒绝新增采集持久化且不创建未追踪原文，转发继续，诊断可读；已提交正文可明确删除，解除压力后重启恢复已有日志且不重放上游

#### Scenario: Native writer invalidates an async capacity snapshot
- **WHEN** 同连接扫描或第二SQLite连接在实际stat完成后、抓包提交前写入，使先前安全的WAL水位失效，或使checkpoint后的二次测量失效
- **THEN** total_changes/schema_version/data_version发现已观察行/结构写入，最多3次总测量及一次零等待checkpoint后按实测水位拒绝或执行一次；持续变更返回容量不可确认，不覆盖扫描原文/事件/指标/身份，不把该回归当作任意未来写入或长期共库容量证明

#### Scenario: Caller transaction overlaps capacity IO
- **WHEN** 准入调用前或异步IO期间，调用方已开启SQLite事务
- **THEN** 不调用抓包mutation，不回滚调用方事务，以静态容量不可确认错误结束；零等待状态检查须恢复调用方原busy_timeout

#### Scenario: SQLite reports native full during final capture commit
- **WHEN** 真实SQLite引擎因fixture页上限返回SQLITE_FULL
- **THEN** 事务回滚、保存计数为零，原文/日志保持可恢复；解除fixture上限后重启只恢复一次，不把该测试冒充物理磁盘耗尽证明

#### Scenario: Monitoring is left running
- **WHEN** 持续监控跨过保留期或达到容量高水位
- **THEN** 无需重启即可报告容量状态并停止新增正文，Web 显示数据保留范围；大列表依然不返回正文，已删除正文无法通过 raw 或导出绕过保留策略取得

#### Scenario: Explicitly expired capture has a surviving recovery journal
- **WHEN** 显式保留期删除一条带原文 ID 的已提交捕获，随后重启读取其遗留日志
- **THEN** 仅请求 ID 和两个原文 ID 都匹配的删除标记阻止重建；关闭/延长保留期也不能复活它，原文文件和扫描数据不删除，不用旧时间戳误判其他证据

#### Scenario: Current explicit TTL covers an uncommitted crash journal
- **WHEN** 同数据库尚未提交的恢复日志严格早于本次非零显式保留期边界
- **THEN** 在读取原文或创建请求前，用有界非阻塞重试原子记录本次精确过期身份；默认0或相等边界仍恢复，写失败保留日志，原文/配额不变，不重放上游或批量删除扫描/关联数据

#### Scenario: Explicit file removal partially fails
- **WHEN** 经确认的持久删除流程调用最多两个原文 ID 的内部文件操作，第二个文件删除失败
- **THEN** 操作报错而非完整成功，流式重新核算配额仅释放实际消失的文件，保留其余文件可重试；读写/恢复期间拒绝删除，不跟随符号链接或递归删除目录

#### Scenario: Confirmed original-file intent survives interruption
- **WHEN** 已同事务写入删除任务和精确恢复拦截标记，随后进程在文件操作或状态提交之间中断
- **THEN** 内部协调器可在重新打开后幂等续处理 pending 任务，失败须显式重试，目录/身份/共享引用/摘要冲突不误删；仅文件任务完成不等于已删除请求元数据或预览，不得先于公开确认流程接通

#### Scenario: Confirmed body deletion blocks capture API bypass
- **WHEN** 监控停止后通过精确请求ID和显式确认提交正文删除
- **THEN** 意图/标记/正文与提示词副本清空同事务提交，维护锁排斥启动和并发删除，文件失败仍拒绝正文下载/分析/diff回退且允许显式重试；headers、元数据、原生扫描数据保留，启动续处理pending，关闭等待所拥有IO

## ADDED Requirements

### Requirement: REQ-019: Durable capture recovery
系统 SHALL 在正文写入前异步持久化有界同数据库采集日志，转发不等待磁盘。恢复 SHALL 流式校验原文前缀并原子写入已有元数据形状；未知时长/token 不伪造，原文 ID 必须一致才能幂等跳过，SQLite 瞬时锁只做有限非阻塞重试。失败保留证据且不发布保存成功，关闭等待恢复，不自动删除原文或重置 scan。

#### Scenario: Recovery fails safely
- **WHEN** 同数据库日志损坏或原文证据冲突
- **THEN** 抓包查询返回统一错误并保留证据，健康检查/扫描不被拖住，不悄悄跳过或认作完整成功

### Requirement: STORE-001 Replayable safe evidence and idempotency
系统 SHALL 在限额内保留规范化所需的证据及版本，以支持离线重新解析；重解析 MUST NOT 重新发送模型请求或执行工具。重复摄取、重连和重新扫描 SHALL 幂等；部分失败和异常退出恢复 SHALL 不制造重复记录或伪造完成状态。可重算范围受实际保留证据限制，缺少证据时 SHALL 明示不可重算。

#### Scenario: Parser is upgraded
- **WHEN** 用新解析版本重新处理同一份已保留的原始 fixture
- **THEN** 请求身份和证据引用不变，指标更新有版本记录，不新增调用计费，也不触发外部请求

#### Scenario: Process is killed during capture or before final index commit
- **WHEN** 已持久化采集日志后进程被强制终止，或最终 SQLite 写入持续失败
- **THEN** 重启只恢复同数据库的请求及原文前缀，保留实际摘要和未知时长/token；原文 ID 匹配才允许幂等跳过，不重放上游、不伪造完成、不自动删除旧原文，失败写入不发布保存成功
