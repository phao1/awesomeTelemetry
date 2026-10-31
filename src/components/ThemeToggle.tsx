import { IconButton } from './ui/Button.js';
import { Tooltip } from './ui/Overlay.js';
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
  const description=`theme: ${theme} (${effective})`;
  return <Tooltip label={description}><IconButton label={`theme: ${theme}`} title={description} icon={<IconContrast size={16}/>} onClick={onCycle}/></Tooltip>;
}
