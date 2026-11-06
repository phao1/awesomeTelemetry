# Mini coding Agent

这是第二个被优化对象：无 npm 包依赖的 Node Agent，不使用 OpenCode CLI 或会话库。
`source/agent.mjs` 调用 OpenAI chat completions，用累积 messages 循环处理工具调用，
提供 shell（command）、read_file（path）、write_file（path/content）。
读取 OPENAI_BASE_URL、OPENAI_API_KEY、OPENAI_MODEL，题面为第一个参数。

把 source/ 初始化成独立 Git 仓库后即可用 profile.json 创建任务。Dockerfile 假设
被优化仓库根目录有 agent.mjs 和 package.json。没有依赖输入，候选语法检查完全离线。
会话 format=none；每次模型响应与最后一次请求由通用代理轨迹保留，token 以代理为准。

外部完整实跑：`node scripts/rsi-e2e/mini-agent-smoke.mjs --docker-context colima-rsi`。
脚本自行建立独立源仓库，使用真实题库的 small 子集和假模型，运行基线、候选 smoke/train，
停在缺少审查的 held。它证明档案/执行链的通用性，不代表模型的真实修复能力。
