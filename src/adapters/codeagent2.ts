// G9.1：CodeAgent 2.0 复用 opencode，thin wrapper。
import { createOpencodeAdapter } from './opencode.js';

export const codeagent2Adapter = createOpencodeAdapter({
  provider: 'codeagent2',
  sourceAgent: 'CodeMate',
  // #6：CodeAgent 2.0 与 CodeArts 同源（DeepSeek），total 不含 reasoning。
  reasoningInTotal: false,
});
