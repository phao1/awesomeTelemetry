// G9.1：CodeArts 复用 opencode，thin wrapper。
import { createOpencodeAdapter } from './opencode.js';

export const codeartsAdapter = createOpencodeAdapter({
  provider: 'codearts',
  sourceAgent: 'CodeArts',
});
