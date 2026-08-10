/**
 * REQ-024：手写 hash 解析/序列化（≤60 行，不引路由库）。
 * D3：hash 是状态的唯一表示，状态变 → 写 hash，hashchange → 解析并应用。
 */

import type { SessionRange } from './core/trace-types.js';

export const HASH_VIEWS = ['session', 'agent', 'compare', 'proxy', 'frida', 'mission'] as const;

/** 色带宽度模式（add-trajectory-inspector D10/D18）。 */
export type RibbonMode = 'time' | 'token';

export interface HashState {
  view: (typeof HASH_VIEWS)[number];
  key?: string;
  phase?: string[];
  provider?: string[];
  status?: string[];
  /** 会话列表搜索（标题 / ID 子串，服务端过滤）。 */
  q?: string;
  /** 会话列表时间范围（缺省 today）。 */
  time?: SessionRange;
  /** 选中 turn 的索引（整数 ≥ 0，add-trajectory-inspector D18）。 */
  turn?: number;
  /** 色带宽度模式（缺省 time，add-trajectory-inspector D10/D18）。 */
  ribbon?: RibbonMode;
  left?: string;
  right?: string;
  /** Mission 视图时间窗（REQ-027：#/mission?range=7d）。 */
  range?: '7d' | '30d' | 'all';
}

export function parseHash(hash: string): HashState | null {
  try {
    const raw = hash.replace(/^#\/?/, '');
    const parts = raw.split('?');
    const path = parts[0] ?? '';
    const query = parts[1] ?? '';
    const view = path === '' ? 'session' : path;
    if (!(HASH_VIEWS as readonly string[]).includes(view)) {
      return null;
    }
    const params = new URLSearchParams(query);
    const list = (key: string): string[] | undefined => {
      const value = params.get(key);
      return value === null ? undefined : value.split(',').filter(Boolean);
    };
    const key = params.get('key');
    const phase = list('phase');
    const provider = list('provider');
    const status = list('status');
    const q = params.get('q');
    const timeRaw = params.get('time');
    const time =
      timeRaw === 'today' || timeRaw === '7d' || timeRaw === '30d' || timeRaw === 'all'
        ? (timeRaw as SessionRange)
        : undefined;
    const turnRaw = params.get('turn');
    const turn =
      turnRaw !== null && turnRaw.trim() !== '' && /^\d+$/.test(turnRaw)
        ? Math.max(0, Number.parseInt(turnRaw, 10))
        : undefined;
    const ribbonRaw = params.get('ribbon');
    const ribbon = ribbonRaw === 'token' ? 'token' : ribbonRaw === 'time' ? 'time' : undefined;
    const left = params.get('left');
    const right = params.get('right');
    const rangeRaw = params.get('range');
    const range =
      rangeRaw === '7d' || rangeRaw === '30d' || rangeRaw === 'all' ? rangeRaw : undefined;
    return {
      view: view as HashState['view'],
      ...(key !== null ? { key } : {}),
      ...(phase !== undefined ? { phase } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(q !== null && q !== '' ? { q } : {}),
      ...(time !== undefined ? { time } : {}),
      ...(turn !== undefined ? { turn } : {}),
      ...(ribbon !== undefined ? { ribbon } : {}),
      ...(left !== null ? { left } : {}),
      ...(right !== null ? { right } : {}),
      ...(range !== undefined ? { range } : {}),
    };
  } catch {
    return null;
  }
}

export function serializeHash(state: HashState): string {
  const params = new URLSearchParams();
  if (state.key !== undefined) {
    params.set('key', state.key);
  }
  if (state.phase !== undefined && state.phase.length > 0) {
    params.set('phase', state.phase.join(','));
  }
  if (state.provider !== undefined && state.provider.length > 0) {
    params.set('provider', state.provider.join(','));
  }
  if (state.status !== undefined && state.status.length > 0) {
    params.set('status', state.status.join(','));
  }
  if (state.q !== undefined && state.q !== '') {
    params.set('q', state.q);
  }
  if (state.time !== undefined) {
    params.set('time', state.time);
  }
  if (state.turn !== undefined) {
    params.set('turn', String(state.turn));
  }
  if (state.ribbon !== undefined) {
    params.set('ribbon', state.ribbon);
  }
  if (state.left !== undefined) {
    params.set('left', state.left);
  }
  if (state.right !== undefined) {
    params.set('right', state.right);
  }
  if (state.range !== undefined) {
    params.set('range', state.range);
  }
  const query = params.toString();
  return `#/${state.view}${query === '' ? '' : `?${query}`}`;
}
