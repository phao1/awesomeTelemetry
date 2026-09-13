import type { Locale } from '../../i18n.js';

const ZH = {
  title: 'Agent 交互',
  single: '本会话只有一个 Agent，没有派发/交接边。',
  summary: '{agents} 个 Agent · {edges} 条交互 · 并行度 {ratio}',
  spawn: '派发',
  handoff: '交接',
  return: '回传',
  criteria: '交互边从 kind / tool / title 启发式还原，不是厂商原生协议。',
  timing: '时间总览',
  parallel: '并行度 {ratio}',
} as const;

const EN = {
  title: 'Agent interactions',
  single: 'This session is a single agent; no spawn or handoff edges.',
  summary: '{agents} agents · {edges} interactions · parallelism {ratio}',
  spawn: 'spawn',
  handoff: 'handoff',
  return: 'return',
  criteria: 'Edges are reconstructed from kind / tool / title heuristics, not a vendor protocol.',
  timing: 'Timing overview',
  parallel: 'parallelism {ratio}',
} as const;

export type InteractCopyKey = keyof typeof ZH;

export function ti(key: InteractCopyKey, locale: Locale): string {
  return locale === 'zh' ? ZH[key] : EN[key];
}
