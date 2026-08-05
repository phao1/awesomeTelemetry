import { useCallback, useEffect, useState } from 'react';

/** REQ-003：三态主题偏好。 */
export type ThemePreference = 'system' | 'dark' | 'light';
export type EffectiveTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'awesome-telemetry.theme';
/** B6（§8）兼容回退：老版本品牌键，读新键失败时兜底，并顺手回写新键。 */
const LEGACY_THEME_STORAGE_KEY = 'agent-observability.theme';

const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light'];

export function getStoredTheme(): ThemePreference {
  let stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === null) {
    const legacy = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacy !== null) {
      stored = legacy;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, legacy);
      } catch (err) {
        void err;
      }
    }
  }
  return stored === 'dark' || stored === 'light' || stored === 'system'
    ? stored
    : 'system';
}

export function storeTheme(pref: ThemePreference): void {
  localStorage.setItem(THEME_STORAGE_KEY, pref);
}

function systemDark(): boolean {
  if (typeof window === 'undefined' || window.matchMedia === undefined) {
    return true; // 无系统偏好时按 dark（契约 §1）
  }
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const light = window.matchMedia('(prefers-color-scheme: light)').matches;
  return dark || !light;
}

/** 解析有效主题：system 跟随系统，无偏好时按 dark（契约 §1）。 */
export function resolveEffectiveTheme(pref: ThemePreference, systemIsDark: boolean): EffectiveTheme {
  if (pref === 'dark' || pref === 'light') {
    return pref;
  }
  return systemIsDark ? 'dark' : 'light';
}

function applyTheme(pref: ThemePreference): EffectiveTheme {
  const effective = resolveEffectiveTheme(pref, systemDark());
  document.documentElement.setAttribute('data-theme', effective);
  return effective;
}

/**
 * REQ-003：三态主题 hook。
 * - localStorage `awesome-telemetry.theme` 持久化（旧键 agent-observability.theme
 *   兜底回退，B6 §8）
 * - system 下监听 matchMedia change 实时跟随（G-DS-3：addEventListener）
 * - 切换只改 data-theme，不触发整页重载、不闪白
 */
export function useTheme(): {
  theme: ThemePreference;
  effective: EffectiveTheme;
  cycle: () => void;
  setTheme: (pref: ThemePreference) => void;
} {
  const [theme, setThemeState] = useState<ThemePreference>(() => getStoredTheme());
  const [effective, setEffective] = useState<EffectiveTheme>(() =>
    applyTheme(getStoredTheme()),
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => {
      const stored = getStoredTheme();
      if (stored === 'system') {
        setEffective(applyTheme('system'));
      } else if (stored === 'dark' || stored === 'light') {
        // 显式选择不跟随系统
        void event;
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((pref: ThemePreference) => {
    storeTheme(pref);
    setThemeState(pref);
    setEffective(applyTheme(pref));
  }, []);

  const cycle = useCallback(() => {
    const next = THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(theme) + 1) % THEME_PREFERENCES.length]!;
    setTheme(next);
  }, [theme, setTheme]);

  return { theme, effective, cycle, setTheme };
}
