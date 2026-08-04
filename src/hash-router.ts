/**
 * REQ-024：手写 hash 解析/序列化（≤60 行，不引路由库）。
 * D3：hash 是状态的唯一表示，状态变 → 写 hash，hashchange → 解析并应用。
 */

export const HASH_VIEWS = ['session', 'agent', 'compare', 'proxy', 'frida'] as const;

export interface HashState {
  view: (typeof HASH_VIEWS)[number];
  key?: string;
  phase?: string[];
  provider?: string[];
  status?: string[];
  left?: string;
  right?: string;
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
    const left = params.get('left');
    const right = params.get('right');
    return {
      view: view as HashState['view'],
      ...(key !== null ? { key } : {}),
      ...(phase !== undefined ? { phase } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(left !== null ? { left } : {}),
      ...(right !== null ? { right } : {}),
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
  if (state.left !== undefined) {
    params.set('left', state.left);
  }
  if (state.right !== undefined) {
    params.set('right', state.right);
  }
  const query = params.toString();
  return `#/${state.view}${query === '' ? '' : `?${query}`}`;
}
