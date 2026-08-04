import type { ThemePreference } from '../theme.js';
import { IconDeviceDesktop, IconMoon, IconSun } from './icons/index.js';

interface ThemeToggleProps {
  theme: ThemePreference;
  effective: 'dark' | 'light';
  onCycle: () => void;
}

/**
 * REQ-003：全局头右侧主题按钮，循环 system → dark → light。
 * 图标 system→device-desktop / dark→moon / light→sun（契约 §2.4 映射）。
 * 三枚图标各自独立路径（REQ-004），此处先内联，图标库落地后换用 Icon*。
 */
export function ThemeToggle({ theme, effective, onCycle }: ThemeToggleProps): React.JSX.Element {
  const ThemeIcon =
    theme === 'dark' ? IconMoon : theme === 'light' ? IconSun : IconDeviceDesktop;
  return (
    <button
      type="button"
      className="btn"
      onClick={onCycle}
      title={`theme: ${theme} (${effective})`}
      aria-label={`theme: ${theme}`}
    >
      <ThemeIcon size={16} />
    </button>
  );
}
