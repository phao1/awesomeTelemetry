import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import * as icons from './index.js';

/** REQ-004 清单（contracts/design-tokens.md §8 + specs/design-system/spec.md REQ-004）。 */
const ICON_NAMES = [
  'IconSessions',
  'IconAgents',
  'IconCompare',
  'IconProxy',
  'IconFrida',
  'IconSidebar',
  'IconPanel',
  'IconCommand',
  'IconUnderstand',
  'IconPlan',
  'IconImplement',
  'IconDebug',
  'IconVerify',
  'IconReport',
  'IconSuccess',
  'IconError',
  'IconRunning',
  'IconPending',
  'IconCancelled',
  'IconWarning',
  'IconMessage',
  'IconTool',
  'IconFile',
  'IconTerminal',
  'IconThought',
  'IconSystem',
  'IconSpeed',
  'IconAccuracy',
  'IconStability',
  'IconCost',
  'IconSearch',
  'IconFilter',
  'IconRefresh',
  'IconCopy',
  'IconDownload',
  'IconExternalLink',
  'IconTrash',
  'IconClose',
  'IconChevronRight',
  'IconChevronDown',
  'IconKebab',
  'IconPlus',
  'IconGear',
  'IconGlobe',
  'IconSun',
  'IconMoon',
  'IconDeviceDesktop',
  'IconContrast',
  'IconDashboard',
  'IconList',
  'IconGitCompare',
  'IconFlask',
  'IconNetwork',
  'IconPlug',
  'IconSettings',
  'IconChevronUp',
  'IconChevronLeft',
  'IconCheck',
  'IconX',
  'IconMinus',
  'IconMoreHorizontal',
  'IconUpload',
  'IconAlertTriangle',
  'IconAlertCircle',
  'IconCheckCircle',
  'IconXCircle',
  'IconInfo',
  'IconClock',
  'IconHourglass',
  'IconCpu',
  'IconDatabase',
  'IconZap',
  'IconUser',
  'IconBot',
  'IconUsers',
  'IconWrench',
  'IconFileText',
  'IconEye',
  'IconEyeOff',
  'IconLanguages',
  'IconPanelLeft',
  'IconArrowUp',
  'IconArrowDown',
  'IconTrendingUp',
  'IconTrendingDown',
  'IconPlay',
  'IconPause',
  'IconSparkles',
  'IconLayers',
  'IconMessageSquare',
  'IconGitBranch',

] as const;

describe('REQ-004 图标集（T6 / T7）', () => {
  it('T6: 导出名集合与清单严格相等，无多无少（= 48）', () => {
    const exported = Object.keys(icons).filter((key) => key !== 'IconShell').sort();
    expect(exported).toEqual([...ICON_NAMES].sort());
    expect(ICON_NAMES).toHaveLength(91);
    expect(exported).toHaveLength(91);
  });

  it('T7: 每个图标含 viewBox="0 0 16 16"，无 fill="#"/stroke="#"', () => {
    for (const name of ICON_NAMES) {
      const Component = icons[name] as (props?: Record<string, unknown>) => React.JSX.Element;
      const markup = renderToStaticMarkup(<Component />);
      expect(markup, name).toContain('viewBox="0 0 16 16"');
      expect(markup, name).toContain('stroke-width="1.5"');
      expect(markup, name).toContain('stroke-linecap="round"');
      expect(markup, name).not.toMatch(/fill="#/);
      expect(markup, name).not.toMatch(/stroke="#/);
    }
  });

  it('T7: 装饰图标 aria-hidden，label 提供时 role="img" + <title>', () => {
    const plain = renderToStaticMarkup(<icons.IconSearch />);
    expect(plain).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(<icons.IconSearch label="搜索" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('<title>搜索</title>');
  });

  it('T7: 尺寸只允许 12/16/20/24，默认 16', () => {
    const markup = renderToStaticMarkup(<icons.IconPlus size={20} />);
    expect(markup).toContain('width="20"');
    expect(renderToStaticMarkup(<icons.IconPlus />)).toContain('width="16"');
  });

  it('§8: 单个图标路径数据 ≤ 512 字节', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'components', 'icons', 'index.tsx'), 'utf8');
    expect(Buffer.byteLength(source)).toBeLessThan(12 * 1024);
    const ds = [...source.matchAll(/makeIcon\("([^"]*)"\)/g)].map((m) => m[1]!);
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) {
      expect(Buffer.byteLength(d)).toBeLessThanOrEqual(512);
    }
  });

  it('F2: expanded rendered SVG audit < 32KiB', () => {
    let total = 0;
    for (const name of ICON_NAMES) {
      const Component = icons[name] as (props?: Record<string, unknown>) => React.JSX.Element;
      total += Buffer.byteLength(renderToStaticMarkup(<Component />), 'utf8');
    }
    expect(total).toBeLessThan(32 * 1024);
  });
});
