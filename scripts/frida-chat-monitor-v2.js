// REQ-015/G6.3：monitor 模式（持续监听），不是一次性 scan。Rust heap 碎片化使 scan 抓不全。
// P-3：需要 Windows + Trae，本仓库 CI 无法端到端验证。
// 输出标记：console.log('[NEW CHAT DATA]' + JSON.stringify(data) + '[END]')
// 目标：在 ai_agent.dll 的 ring crate 堆上监听 system prompt / user query 组装。
// 骨架：完整 hook 点依赖具体 Trae 版本，见 skills/decrypt-trae-cn.md。

function main() {
  console.log('[FRIDA_READY]');
  // TODO(P-3): 按 ai_agent.dll 版本 hook system prompt 组装函数
  setImmediate(() => {
    console.log('[NEW CHAT DATA]{"note":"monitor skeleton"}[END]');
  });
}

main();
