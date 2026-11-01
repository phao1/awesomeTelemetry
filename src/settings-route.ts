/** Canonical settings sections: contracts/data-model.md F5 review. */
export type SettingsSection = 'general' | 'appearance' | 'health' | 'alert-thresholds' | 'storage' | 'about';
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ['general', 'appearance', 'health', 'alert-thresholds', 'storage', 'about'];
export function isSettingsSection(value: unknown): value is SettingsSection { return typeof value==='string' && SETTINGS_SECTIONS.includes(value as SettingsSection); }
