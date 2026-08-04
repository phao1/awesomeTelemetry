// G9.1：CodeAgent 2.0 复用 opencode，thin wrapper。
import { createOpencodeAdapter } from './opencode.js';

export const codeagent2Adapter = createOpencodeAdapter({
  provider: 'codeagent2',
  sourceAgent: 'CodeMate',
});
