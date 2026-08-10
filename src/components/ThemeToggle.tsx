import type { ThemePreference } from '../theme.js';
import { IconContrast } from './icons/index.js';

interface ThemeToggleProps {
  theme: ThemePreference;
  effective: 'dark' | 'light';
  onCycle: () => void;
}

/**
 * REQ-003：全局头右侧主题按钮，循环 system → dark → light。
 * 统一使用 IconContrast（亮/暗对比），按钮 title/aria 仍如实表达当前状态。
 */
export function ThemeToggle({ theme, effective, onCycle }: ThemeToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn"
      onClick={onCycle}
      title={`theme: ${theme} (${effective})`}
      aria-label={`theme: ${theme}`}
    >
      <IconContrast size={16} />
    </button>
  );
}
