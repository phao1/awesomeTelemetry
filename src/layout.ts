/**
 * REQ-026：布局偏好持久化（localStorage，键前缀 agent-observability.）。
 * 读取时 MUST 做范围校验（越界回落到默认），脏数据不得崩溃。
 */

const PREFIX = 'agent-observability.';

export const LAYOUT_KEYS = {
  railWidth: `${PREFIX}layout.railWidth`,
  inspectorWidth: `${PREFIX}layout.inspectorWidth`,
  railCollapsed: `${PREFIX}layout.railCollapsed`,
  inspectorCollapsed: `${PREFIX}layout.inspectorCollapsed`,
  fontSize: `${PREFIX}fontSize`,
  paletteHintSeen: `${PREFIX}paletteHintSeen`,
} as const;

export const LAYOUT_RANGES = {
  railWidth: { min: 260, max: 480 },
  inspectorWidth: { min: 280, max: 900 },
  fontSize: { min: 8, max: 28 },
} as const;

export function loadNumber(
  key: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(range.max, Math.max(range.min, parsed));
  } catch (err) {
    console.error(`[layout] 读取 ${key} 失败:`, err);
    return fallback;
  }
}

export function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === 'true' ? true : raw === 'false' ? false : fallback;
  } catch (err) {
    console.error(`[layout] 读取 ${key} 失败:`, err);
    return fallback;
  }
}

export function storeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch (err) {
    console.error(`[layout] 写入 ${key} 失败:`, err);
  }
}

export function storeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch (err) {
    console.error(`[layout] 写入 ${key} 失败:`, err);
  }
}
