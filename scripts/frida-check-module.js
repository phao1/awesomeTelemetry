// REQ-014：最小探测脚本——检查 ai_agent.dll 是否已加载。
// P-3：需要 Windows + Trae，本仓库 CI 无法端到端验证。
// 输出 [AI_AGENT_FOUND] 标记。

/* global Process */
function main() {
  const modules = Process.enumerateModules();
  const found = modules.some((m) => m.name.toLowerCase().includes('ai_agent'));
  console.log(found ? '[AI_AGENT_FOUND]' : '[AI_AGENT_NOT_FOUND]');
}

main();
