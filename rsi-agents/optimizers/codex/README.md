# Codex

可信优化者档案；仅经 RSI agent API 和 handoff 工作。每轮全新 internal 网络容器。

**未实测**：登录、厂商域名白名单和 CLI 行为须在沙箱外验证。
默认拒绝执行；需要显式 --allow-unmetered-optimizer 或 WorkerSettings.allowUnmeteredOptimizer=true。
CONNECT 加密流量无法可信计量，用量仅为 nullable self_reported 诊断，不计任务预算、不参与判定。
登录命令：`rsi optimizer login --profile codex`。平台打印并执行全新交互容器命令，登录态只存专用 Docker 命名卷。
不读取或复制宿主 ~/.codex、~/.claude 或 ~/.ssh。运行有总时长硬上限。
白名单按精确域名匹配；上游增加域名时必须人工更新可信档案，不能放宽为任意 CONNECT。
