## Purpose

让开发者在明确授权的本地范围内开启 Agent 监控，将网络证据与原生执行记录关联成可核验的端到端 Trace，明确缺失和推测边界，并据此分析上下文、工具、性能与成本问题。

## ADDED Requirements

### Requirement: MON-001 Supported connection and monitoring lifecycle
系统 SHALL 为每个 Agent/版本/操作系统组合展示网络、原生会话、工具、子 Agent 的实测支持程度及前置条件。首次接入 SHALL 区分证书信任、代理配置、受控启动与已有进程；之后一次点击 SHALL 启动已配置范围内的监控。监听成功不等于 Agent 已连接，未见流量 SHALL 明示等待流量。停止、启动失败、进程崩溃 SHALL 有明确结果，不泄露残留监听器或覆盖用户后来更改的配置。

#### Scenario: First connection is incomplete
- **WHEN** 用户点击开启但目标运行时尚未信任证书，或已运行进程未使用代理
- **THEN** 系统显示具体缺项与可执行的修复步骤，不报告正在成功采集，也不静默安装证书或重启 Agent

#### Scenario: Repeated start and stop
- **WHEN** 启动过程中停止并再次启动，旧启动异步结果稍后返回
- **THEN** 只有最新有效运行拥有监听器和采集记录；端口占用返回统一错误，不永久停留在启动中

#### Scenario: Read-only connection investigation
- **WHEN** 用户在 Web 或 CLI 显式检查已保存配置
- **THEN** 同一后端报告区分预期端口监听、当前共享流量、公共 CA 与未验证的目标运行时信任，提供超时／绑定／采集错误的下一步；不启动 Agent、生成 CA 或发上游请求，运行状态变化仅将快照标为过时而不轮询

### Requirement: MON-002 Observable scope and non-interference
系统 MUST 只监控用户选定范围，默认不改系统代理、不外发记录。监控 MUST NOT 为了兼容而删除 thinking、改模型、改工具参数或重写认证。用户 SHALL 能看到每个来源的覆盖范围；工具运行、文件修改、子 Agent 关系只能来自实际可见的原生记录或经授权 hook。请求内工具声明不等于工具已执行；模型未公开的内部状态不属于可保证采集范围。

#### Scenario: Tool execution is not visible on the wire
- **WHEN** 网络响应含 tool call，但本地执行开始/结束记录缺失
- **THEN** 展示调用声明和已知结果，实际执行时长与状态标记未知，不把两次模型调用之间的间隔当成工具实测耗时

### Requirement: MON-003 Identity and evidence-based correlation
系统 SHALL 区分监控运行、原生会话、用户轮次、模型调用及尝试、工具执行。来源标识和原生 ID SHALL 有命名空间，显式父子关系 SHALL 保留。跨来源关联 SHALL 记录依据，区分直接证据、推断候选、用户确认和无关联；相同 host/model、相近时间、capture group 或请求内容 hash MUST NOT 单独作为自动确认会话身份的依据。

#### Scenario: Concurrent agents use the same model
- **WHEN** 两个并发会话使用同一网关和模型，且都缺少显式关联 ID
- **THEN** 请求保持独立，可以给出候选但不得自动串为一个会话或共享 system prompt

#### Scenario: Repeated observations and retries
- **WHEN** 同一模型调用同时出现在代理和扫描记录中，或一次业务调用发生两次真实重试
- **THEN** 有显式对应证据的两份观测只计一次调用；两次真实请求各保留一次尝试与实际 token，无法确认时展示分来源统计，不猜测去重

### Requirement: MON-004 Investigation and optimization workflow
R1 SHALL 在 Web 中支持从会话/关联 Trace 下钻到轮次、模型调用、工具证据、请求/响应、上下文 diff、usage、错误与数据来源；并支持比较两次选定运行。诊断 SHALL 给出可追溯的证据和口径，覆盖上下文膨胀、重复请求/重试、缓存使用、慢调用和工具失败；相关性不得写成因果事实。

#### Scenario: A context expansion is investigated
- **WHEN** 开发者选择两次可比的已关联模型调用
- **THEN** 可以查看 system/instructions、messages、tool schema 的增删和 token 变化；不自动将并发请求的前一条当作同会话上一轮

#### Scenario: Capture persistence completes out of order
- **WHEN** an earlier-started request finishes persistence after a later-started request
- **THEN** automatic comparison orders eligible same-session captures by observed UTC instant with a deterministic id tie-break, labels linked-session evidence and explains that immediate native model-turn adjacency remains unproven

#### Scenario: Accuracy evidence is absent
- **WHEN** 一次执行没有测试结果或评测标签
- **THEN** 展示验证覆盖率等代理指标及其局限，不宣称已测得答案正确率
