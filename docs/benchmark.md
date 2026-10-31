# 同任务自动评测

评测中心把一次实验分为：固定任务 → 工具/模型组合 → 重复执行 → 独立验收 →
指标对比 → 规则诊断 → 泳道证据。入口在顶部「评测中心」，也可直接打开
`#/benchmark`。本模块不修改原有采集数据、任务阅读器或手工实验记录。

## 快速使用

页面直接体验：打开「评测中心」→填写实验名→设置 Qoder GUI/CodeArts GUI 的
示例模型标签→保留每组3次→点击「运行示例评测（6次）」。本地服务会真正执行固定
加法任务、文件修改与3个验收用例，完成后自动呈现报告。奇数组为正确实现，偶数组
故意保留缺陷，用于演示失败诊断。此按钮不调用真实 GUI/模型，不产生模型费用。
可添加组合、使用相同或不同模型标签；真实任务/驱动仍从高级配置导出后由 CLI 执行。

```sh
npm run build
# 不调用模型，先通过真实本地子进程验证评测闭环
npm run benchmark:demo
# 真实实验：先编辑示例中的绝对路径、模型、任务和验收标准
cp config/benchmark.example.json benchmark.json
npm run benchmark -- benchmark.json
npm run benchmark -- benchmark.json --execute --output ./benchmark-results/experiment-001
```

第一条 benchmark 命令仅校验计划。第二条显式执行驱动，可能产生模型调用费用。
输出目录必须不存在；报告和每次工作区均保留，不自动重跑、清理或覆盖实验。
运行后在评测中心导入输出目录的 `report.json`，无需上传到外部服务。
安装包也可使用 `telemetry-benchmark` 命令。

同一实验固定同一个 Git commit、提示词、验收命令和用例数。每个组合默认3次，
按轮次交错并轮转顺序，在独立本地克隆中执行。未提交改动不会进入实验。
运行器顺序执行，避免多个 GUI 同时争用桌面；但不会隔离 GUI 缓存、机器负载和网络，
这些因素需要由驱动及实验环境固定。缺失子模块、依赖安装等由驱动准备并注明。

## 接入 Qoder GUI / 码道 CodeArts GUI

当前交付的是可运行的通用驱动协议，**没有宣称已经完成这两个 GUI 的真实自动操控**。
不同版本/操作系统的选模型、打开项目、提交任务和判断完成方式需要适配真实安装。
仅填入产品名称不等于自动支持该产品。当前也没有从已有会话猜测一次新实验。

每个 `driver` 是可执行程序及参数组成的 JSON 数组，不是 shell 命令字符串。
建议使用绝对路径，例如 `["/path/to/python", "/path/to/qoder_driver.py"]`。
运行器向驱动传递以下环境变量：

| 变量 | 内容 |
| --- | --- |
| `BENCHMARK_CONTEXT` | JSON 文件：task、variant、repetition、commit、workspace |
| `BENCHMARK_WORKSPACE` | 本轮独立工作目录；同时也是进程 cwd |
| `BENCHMARK_RESULT_PATH` | 驱动写入的 telemetry.json 绝对路径 |
| `BENCHMARK_VERDICT_PATH` | 独立验收器写入的 verdict.json 绝对路径 |

GUI 驱动负责：打开本轮工作目录、新建会话、选择配置模型、发送原样提示词、等待
真正结束、保存改动并收集证据。驱动必须前台等待，不能在 GUI 仍运行时提前退出。
模型无法选择或实际模型不符时应记录实际标识或失败，不应假装设置成功。
退出码0仅表示驱动完成；运行器随后单独调用 task.evaluator 来判断正确性。
GUI 进程若由外部启动，驱动必须实现超时/取消清理；运行器只管理它自己的进程组。
macOS/Linux 进程组终止已覆盖测试，Windows 和真实 GUI 清理尚未验证。

telemetry.json 的最小形状（未知字段用 null，不填0）：

```json
{
  "actualModel": null,
  "sessionKey": null,
  "complete": false,
  "usage": {
    "input": null, "output": null, "reasoning": null,
    "cacheRead": null, "cacheWrite": null,
    "inputIncludesCache": null, "outputIncludesReasoning": null
  },
  "spans": []
}
```

模型/工具事件 span 的形状：

```json
{
  "id": "request-1", "kind": "model", "name": "model request",
  "startMs": 100, "durationMs": 8000, "timing": "measured",
  "status": "ok", "firstTokenMs": 1200, "outputTokens": 1000,
  "sessionKey": null, "eventId": null
}
```

`kind` 为 model/tool；`timing` 为 measured/observed/derived；`status` 为
ok/error/unknown。驱动 span 的 startMs 相对驱动启动，firstTokenMs 相对该模型调用
启动。报告会统一偏移为本轮准备启动时刻。durationMs 缺失时用 null，仅绘制起点。
不能把日志相邻时间差或网络连接寿命写成模型推理实测。`complete` 只有覆盖本轮
全部模型和工具调用且 usage 为对应范围汇总时才可为 true。
每轮上限2000 spans，全报告20000；超出应明确不完整，不能丢记录后标完整。

sessionKey/eventId 仅填写现有 telemetry 已保留的原始身份。点击证据后可以在新标签
打开原任务泳道；未提供身份则只看报告证据，不根据时间或名称猜关联。
现有原始 Trace 与网络请求继续保留各自时间域，本模块不会把它们重复计费或相加。

## 独立验收和代码质量

把可信验收脚本放在 Agent 工作区之外，通过绝对路径调用；脚本检查
BENCHMARK_WORKSPACE 中的最终结果。固定测试集并确保 Agent 不能通过改测试取得
虚假通过。此运行器不是恶意代码沙箱，进程仍以当前用户权限执行。

验收器写如下报告并以0表示验收进程成功；所有失败退出均记为失败：

```json
{
  "passed": 245, "total": 371,
  "quality": {
    "loc": 5260, "vulnerabilities": 0, "duplicationPct": 13.4,
    "complexity": 1.69, "redundancy": 0, "buildWarnings": 0,
    "staticWarnings": 1303, "critical": 0, "major": 0,
    "minor": 152, "suggestion": 1151
  }
}
```

示例数字说明格式，不是运行结果。所有质量字段都应来自你固定的分析器规则，
没有运行某分析器时对应字段必须为 null。不会凭 LLM 日志推算漏洞或圈复杂度。
成功必须同时满足驱动与验收进程成功、total 等于 expectedTests、passed 等于 total。
缺失报告/数量不符显示未知；超时或执行错误显示失败。报告的 `host` 为运行器主机名，
不猜测 IP；跨机器实验需要各机器运行并保留环境说明。

## 稳准快省的口径

- 稳：已知验收成功数/已知数、未知数、重复次数、E2E 的总体标准差和变异系数 CV。
  小于3次或未跑完给出样本不足提示；不把3次试验当统计显著性证明。
- 准：固定用例通过率、独立代码质量字段；助手结束和工具无报错不能替代验收。
- 快：Agent E2E 单独计时；准备/验收另列。模型与工具的调用数、均值、累计时长，
  TTFT=每次调用首Token延迟的算术平均；TPOT=Σ(调用耗时−首Token延迟)/Σ(输出Token−1)。
  未实测或覆盖不完整不输出这些耗时结论，累计时长允许重叠，不能替代E2E。
- 省：输入、输出、思考、命中、写入分别展示；inputIncludesCache 决定是否加缓存，
  outputIncludesReasoning 决定是否加思考。包含关系未知/矛盾时修正总量留空。
  命中率=cacheRead/包含缓存的总输入。Token 数量不直接等于费用。

对比表可选均值/中位数/P95，每项显示有效样本 n。P95 使用 nearest-rank。
不同模型、参数、环境的结果是配置组合对比，不单独归因于产品。
目前诊断包括验收失败/缺失、采集不全、模型不符、工具错误、慢首Token、低缓存命中、
Token口径不明和代码质量阈值。每条写明排查/优化方向与复测办法；根因仍需证据验证。
页面的合成示例完全离线；真实子进程 demo 只验证框架，不验证厂商能力。

## 验证范围与任务模式实验

通用评测的旧草稿与回归记录保留在本地历史工作材料中。本次交付会重新验证实际提交范围，
不把旧检查数量当作当前结论。坏 telemetry 不再阻止独立验收实际产物；缺失采集仍保留未知。

单 loop、主子 Agent 和 Team 的同任务实验使用新增的
[任务模式实验](team-experiment.md)：支持各组提示词、配对并发、具名用例比较和同步回放。
本页通用产品/模型评测仍使用共同提示词和顺序调度，二者的运行契约保持明确。
