## MODIFIED Requirements

### Requirement: REQ-013: scan/proxy shown separately
扫描会话和代理捕获 SHALL 保留独立原始视图和来源标识，不混写成同一原始数据集。在此基础上 SHALL 提供明确标记的关联 Trace 探索入口，展示来源证据和关联可信度，不把候选关系当已确认父子关系，也不重复累计调用成本。

#### Scenario: Linked exploration
- **WHEN** 开发者从扫描会话进入关联 Trace
- **THEN** 可以下钻其已确认的网络请求和工具证据，并分别返回原始视图；无证据的请求保持未关联

### Requirement: REQ-020: explicit per-request body retention control
选中请求的详情 SHALL 提供中英文正文保留状态、精确请求身份和删除范围说明；只有监控已停止且用户显式勾选不可撤销确认后才能提交。首次选择只读一次元数据状态，刷新/失败重试均显式触发，不轮询、不逐行请求。提交或已知删除意图 SHALL 清除当前正文/提示词/分析/diff缓存并使迟到响应失效；同一视图重开旧详情不能恢复正文。保留headers、时序、关联和原生会话，不把失败/超时报告为删除成功或已释放空间。

Proxy SHALL 提供按需容量抽屉，只有打开或显式刷新才各读取一次原文配额与DB/WAL状态，5秒取消且分别展示错误/未知；显示配额剩余和实际文件水位，不能当作物理剩余空间、Agent接入或采集成功证明。运行状态改变仅标记快照过时、不轮询。此前已确认的pending删除可能由原文状态查询续处理，必须明示且不创建新删除意图。浮层拥有非Esc按键，后台全局快捷键不得吞掉按钮回车或已处理事件；实时状态更新不得重置用户焦点。

#### Scenario: Quota and metadata pressure differ
- **WHEN** 原文配额满额而WAL读取事务随后解除，用户按回车刷新容量
- **THEN** 只新增两个查询，DB/WAL可变为低于水位但原文仍满额，未触发自动删除或采集；Esc关闭返回触发按钮，未知查询不得显示零或成功

#### Scenario: Explicit confirmation and uncertain result
- **WHEN** 用户展开删除确认但未勾选，或提交后连接中断
- **THEN** 前者不能提交且Escape取消返回焦点；后者显示未确认并允许显式查状态，不能因null/旧详情结果重新显示已阻止正文

#### Scenario: Cached or late body response
- **WHEN** 已缓存上下文差异或分析仍在请求时用户确认正文删除
- **THEN** 隐藏正文下载/分析/diff并清缓存，迟到结果和重新打开的旧详情不得恢复正文，headers仍可查看

## ADDED Requirements

### Requirement: UI-MON-001 Setup and coverage are visible
Web SHALL 提供接入检查、选定 Agent 开启/停止监控、真实连接状态、采集量与丢弃/失败数。仅已通过实际平台测试的组合可显示已验证。未启用、待配置、待流量、采集中、部分可用和失败 SHALL 可区分；每个失败 SHALL 提供原因与可操作下一步。

#### Scenario: Proxy runs but captures nothing
- **WHEN** 代理端口已监听但 Agent 没有通过它发送请求
- **THEN** 显示待流量及目标接入检查，不以绿色成功状态暗示已观测 Agent 全链路

### Requirement: UI-MON-002 Evidence-first trace inspection
Web SHALL 提供会话/轮次/模型调用/工具的分页虚拟化时间线及详情；详情含来源、口径、完整性、请求上下文、响应、工具、usage 和错误。原始正文 SHALL 按需加载；原文模式 SHALL 按已批准的本地访问策略展示。未知数据为破折号并解释原因。图形关系仅反映已确认边，候选关系显式区分；无 router 库且 App 保持唯一状态 shell。

#### Scenario: Large linked trace
- **WHEN** 打开大规模 Trace 并查看一条模型调用的正文
- **THEN** 只加载有界元数据页及该次正文，不能为每行发起详情请求，也不将正文塞进 SSE 列表更新

### Requirement: UI-MON-003 Actionable comparison
开发者 SHALL 能比较两个选定运行或调用的上下文、token、可比时长与失败，并看到诊断证据。不同采集完整性、模型、工具集或指标口径 SHALL 提醒不可直接归因；验证覆盖率不是正确率。新增交互 SHALL 同时有中文/英文、加载/空/错误状态与键盘可达性。

#### Scenario: Incomparable timing
- **WHEN** 左侧只有相邻日志推导时长而右侧有代理实测首内容时间
- **THEN** 系统分别展示并解释差别，不自动生成“右侧快 N 倍”的结论
