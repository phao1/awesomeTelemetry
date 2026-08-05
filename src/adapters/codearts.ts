// G9.1：CodeArts 复用 opencode，thin wrapper。
import { createOpencodeAdapter } from './opencode.js';

export const codeartsAdapter = createOpencodeAdapter({
  provider: 'codearts',
  sourceAgent: 'CodeArts',
  // #6：真实 CodeArts/DeepSeek 数据（2026-08-04 校准）——total 不含 reasoning。
  reasoningInTotal: false,
});
