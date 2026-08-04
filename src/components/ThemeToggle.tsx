import type { ThemePreference } from '../theme.js';

const ICON_SIZE = 16;

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
  const icon =
    theme === 'dark'
      ? 'M1.5 8a6.5 6.5 0 0 0 6.5 6.5c2.9 0 5.4-1.9 6.2-4.6a5.5 5.5 0 0 1-7.1-7.1A6.6 6.6 0 0 0 1.5 8Z'
      : theme === 'light'
        ? 'M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'
        : 'M3.5 2h9A1.5 1.5 0 0 1 14 3.5v7A1.5 1.5 0 0 1 12.5 12H8.8l-1.3 2-1.3-2H3.5A1.5 1.5 0 0 1 2 10.5v-7A1.5 1.5 0 0 1 3.5 2Z';
  return (
    <button
      type="button"
      className="btn"
      onClick={onCycle}
      title={`theme: ${theme} (${effective})`}
      aria-label={`theme: ${theme}`}
    >
      <svg
        width={ICON_SIZE}
        height={ICON_SIZE}
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={icon} />
      </svg>
    </button>
  );
}
