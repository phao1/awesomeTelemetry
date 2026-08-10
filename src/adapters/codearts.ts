// G9.1：CodeArts 复用 opencode，thin wrapper。
import { createOpencodeAdapter } from './opencode.js';

export const codeartsAdapter = createOpencodeAdapter({
  provider: 'codearts',
  sourceAgent: 'CodeArts',
  // #6：旧 CodeArts/DeepSeek 数据（2026-08-04）的兼容默认值；当源记录带
  // native total 时，opencode adapter 会按当前会话的原生等式重新判定。
  reasoningInTotal: false,
});
