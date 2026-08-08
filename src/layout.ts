/**
 * REQ-026：布局偏好持久化（localStorage，键前缀 awesome-telemetry.）。
 * 读取时 MUST 做范围校验（越界回落到默认），脏数据不得崩溃。
 *
 * B6 品牌改名时只迁移了 theme 键，布局 / 字号 / locale 仍留在旧前缀下，
 * 于是同一份偏好散落在两个命名空间里。这里统一到新前缀，并对旧键做一次性
 * 读旧写新迁移（同 theme.ts 的做法），避免用户升级后偏好凭空丢失。
 */

const PREFIX = 'awesome-telemetry.';
const LEGACY_PREFIX = 'agent-observability.';

/** 读取时若新键缺失而旧键存在，则搬到新键并删除旧键。 */
export function migrateLegacyKey(key: string): void {
  if (!key.startsWith(PREFIX)) {
    return;
  }
  try {
    if (localStorage.getItem(key) !== null) {
      return;
    }
    const legacyKey = LEGACY_PREFIX + key.slice(PREFIX.length);
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      localStorage.setItem(key, legacy);
      localStorage.removeItem(legacyKey);
    }
  } catch (err) {
    // localStorage 不可用（隐私模式 / 配额满）：迁移失败不影响使用，读取方回落默认值
    console.error(`[layout] 旧键迁移 ${key} 失败:`, err);
  }
}

export const LAYOUT_KEYS = {
  railWidth: `${PREFIX}layout.railWidth`,
  inspectorWidth: `${PREFIX}layout.inspectorWidth`,
  railCollapsed: `${PREFIX}layout.railCollapsed`,
  inspectorCollapsed: `${PREFIX}layout.inspectorCollapsed`,
  fontSize: `${PREFIX}fontSize`,
  paletteHintSeen: `${PREFIX}paletteHintSeen`,
  /** add-trajectory-inspector D18：轨迹侧栏宽度（240–300，钳制）。 */
  trajectoryRailWidth: `${PREFIX}trajectory.railWidth`,
  /** add-trajectory-inspector D18：色带模式（time | token）。 */
  trajectoryRibbonMode: `${PREFIX}trajectory.ribbonMode`,
} as const;

export const LAYOUT_RANGES = {
  railWidth: { min: 260, max: 480 },
  inspectorWidth: { min: 280, max: 900 },
  fontSize: { min: 8, max: 28 },
  /** add-trajectory-inspector D18：轨迹侧栏 240–300。 */
  trajectoryRailWidth: { min: 240, max: 300 },
} as const;

/** 色带模式取值（add-trajectory-inspector D10 / D18）。 */
export type RibbonMode = 'time' | 'token';

/** 被删除甘特的旧布局键（D18：读取时忽略并移除，不回写、不生效）。 */
const LEGACY_TIMELINE_LAYOUT_KEYS = [
  `${PREFIX}layout`,
  `${LEGACY_PREFIX}layout`,
] as const;

export function loadNumber(
  key: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  migrateLegacyKey(key);
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
  migrateLegacyKey(key);
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

/**
 * add-trajectory-inspector D18：色带模式读取。
 * - 先做旧键迁移（migrateLegacyKey），再忽略并移除被删除甘特的 `.layout` 键。
 * - 非法值回落 'time'（缺省）；hash 优先于 localStorage，由调用方保证。
 */
export function loadRibbonMode(key: string, fallback: RibbonMode = 'time'): RibbonMode {
  migrateLegacyKey(key);
  try {
    for (const legacy of LEGACY_TIMELINE_LAYOUT_KEYS) {
      if (localStorage.getItem(legacy) !== null) {
        localStorage.removeItem(legacy);
      }
    }
    const raw = localStorage.getItem(key);
    return raw === 'token' ? 'token' : raw === 'time' ? 'time' : fallback;
  } catch (err) {
    console.error(`[layout] 读取 ${key} 失败:`, err);
    return fallback;
  }
}

export function storeRibbonMode(key: string, value: RibbonMode): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.error(`[layout] 写入 ${key} 失败:`, err);
  }
}
