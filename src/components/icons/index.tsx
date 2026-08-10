import type { ReactNode } from 'react';

/**
 * REQ-004：47 个手写内联 SVG 图标（16×16 网格、currentColor、零依赖）。
 * 约束见 contracts/design-tokens.md §8：viewBox="0 0 16 16"、SVG 内不得写死颜色、
 * 尺寸只允许 12/16/20/24、单图标路径 ≤ 512 字节、全套 ≤ 12KB。
 * 命名导出（design.md D3）：不用 <Icon name> 字符串映射，保证可 tree-shake。
 */

export interface IconProps {
  size?: 12 | 16 | 20 | 24;
  className?: string;
  /** 省略 = aria-hidden 装饰图标；提供 = role="img" 并渲染 <title>（REQ-004 Scenario） */
  label?: string;
}

interface IconShellProps extends IconProps {
  children: ReactNode;
}

function IconShell({ size = 16, className, label, children }: IconShellProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'img'}
    >
      {label !== undefined && <title>{label}</title>}
      {children}
    </svg>
  );
}

/** 导航 / 视图（8） */

export function IconSessions(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2 3.5h12v1.6H2zM2 7.2h12v1.6H2zM2 10.9h12v1.6H2z" />
    </IconShell>
  );
}

export function IconAgents(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2 2h5.2v5.2H2zM8.8 2H14v5.2H8.8zM2 8.8h5.2V14H2zM8.8 8.8H14V14H8.8z" />
    </IconShell>
  );
}

export function IconCompare(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2 2h2.6v12H2zM11.4 4.2H14v9.8h-2.6z" />
      <path d="m6.1 3 2.7 2.5L6.1 8V3Z" />
      <path d="m9.9 8 2.7 2.5L9.9 13V8Z" />
    </IconShell>
  );
}

export function IconProxy(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2 5.2h7.2L7.3 3.3l1.1-1.1 3.5 3.5-3.5 3.5-1.1-1.1 1.9-1.9H2V5.2Z" />
      <path d="M14 10.8H6.8l1.9 1.9-1.1 1.1-3.5-3.5 3.5-3.5 1.1 1.1-1.9 1.9H14v1Z" />
    </IconShell>
  );
}

export function IconFrida(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M3.5 1.5h9v13h-9zM6 6h4v4H6z" />
      <path d="M5.5 1.5V.5h1.2v1h1.1V.5h1.2v1h1.1V.5h1.2v1zM5.5 14.5v1h1.2v-1h1.1v1h1.2v-1h1.1v1h1.2v-1zM1.5 5.5h1v1.1h-1zM1.5 8.6h1v1.1h-1zM1.5 11.7h1v1.1h-1zM13.5 5.5h1v1.1h-1zM13.5 8.6h1v1.1h-1zM13.5 11.7h1v1.1h-1z" />
    </IconShell>
  );
}

export function IconSidebar(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2 2h3v12H2z" />
      <path fillRule="evenodd" d="M6 2h8v12H6zM7.2 3.2h5.6v9.6H7.2z" />
    </IconShell>
  );
}

export function IconPanel(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M11 2h3v12h-3z" />
      <path fillRule="evenodd" d="M2 2h8v12H2zM3.2 3.2h5.6v9.6H3.2z" />
    </IconShell>
  );
}

export function IconCommand(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M3.5 3.5H8v1.6H5.1v2.9H3.5zM8 3.5h4.5V8h-1.6V5.1H8zM3.5 8h1.6v2.9H8v1.6H3.5zM10.9 8h1.6v4.5H8v-1.6h2.9z" />
    </IconShell>
  );
}

/** Phase（6）— 与 --phase-* 一一对应，颜色不得单独承载语义 */

export function IconUnderstand(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M6.5 3a3.5 3.5 0 1 0 2.1 6.3l3.6 3.6 1.1-1.1-3.6-3.6A3.5 3.5 0 0 0 6.5 3Zm0 1.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z" />
      <path d="M9.4 8.2 13.8 12.6 12.6 13.8 8.2 9.4Z" />
    </IconShell>
  );
}

export function IconPlan(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M3 3.2 4.2 4.4 7 1.6l1.2 1.2L4.2 6.8 1.8 4.4 3 3.2Z" />
      <path d="M9.5 2.4H14v1.6H9.5zM2 8h12v1.6H2zM2 11.4h12V13H2z" />
    </IconShell>
  );
}

export function IconImplement(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="m5.5 3-4 5 4 5 1.3-1.1L3.9 8l2.9-3.9L5.5 3Z" />
      <path d="m10.5 3 4 5-4 5-1.3-1.1L12.1 8 9.2 4.1 10.5 3Z" />
    </IconShell>
  );
}

export function IconDebug(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M5 6.5h6v3.8a3 3 0 0 1-3 3 3 3 0 0 1-3-3V6.5Z" />
      <path d="M6.5 3.2h3v3.3h-3zM3.2 5.5h1.8v2H3.2zM11 5.5h1.8v2H11z" />
      <path d="M4 9h1.8v1.6H4zM10.2 9H12v1.6h-1.8z" />
    </IconShell>
  );
}

export function IconVerify(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M6 2h4v2.8l4 6.2a1.6 1.6 0 0 1-1.4 2.5H3.4A1.6 1.6 0 0 1 2 11L6 4.8V2Z" />
      <path d="M5.6 10.2h4.8v1.4H5.6z" />
    </IconShell>
  );
}

export function IconReport(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M3.5 1.5H9l3.5 3.5v9.5h-9zM5 7h6v1.6H5zm0 3h6v1.6H5zM5 13h3.4v-1.6H5z" />
    </IconShell>
  );
}

/** 状态（6） */

export function IconSuccess(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Z" />
      <path d="m4.6 8.2 2.4 2.4 4.4-4.4-1.1-1.1-3.3 3.3-1.3-1.3-1.1 1.1Z" />
    </IconShell>
  );
}

export function IconError(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Z" />
      <path d="m5 5 1.1-1.1L8 5.9l1.9-2L11 5 9.1 7 11 9l-1.1 1.1L8 8.1 6.1 10 5 8.9 6.9 7 5 5Z" />
    </IconShell>
  );
}

export function IconRunning(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </IconShell>
  );
}

export function IconPending(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Z" />
      <path d="M7.2 4.5h1.6v3.4l2.3 1.4-.8 1.3-3.1-1.9V4.5Z" />
    </IconShell>
  );
}

export function IconCancelled(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Z" />
      <path d="M4.4 8h7.2v1.6H4.4z" />
    </IconShell>
  );
}

export function IconWarning(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="m8 1.5 6.5 12.5H1.5L8 1.5Z" />
      <path d="M7.2 5.5h1.6v4.2H7.2zM7.2 11h1.6v1.6H7.2z" />
    </IconShell>
  );
}

/** 事件类型（6）— 对应 TraceEvent.kind */

export function IconMessage(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M1.5 2h13v8.5h-7.5L3.5 13.5V10.5H1.5V2Z" />
    </IconShell>
  );
}

export function IconTool(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="m9.8 2 3.8 3.8-1.1 1.1L8.7 3.1z" />
      <path d="M2 11.2 5.3 7.9l1.3 1.3-3.3 3.3L2 11.2Z" />
      <path d="M11.8 7.6 14 9.8a2.4 2.4 0 0 1-3.4 0l-2-2 1.3-1.3 2 2a1 1 0 0 0 1.4 0l-.5-1 1.1-1.1.9.9-1.5 1.3Z" />
    </IconShell>
  );
}

export function IconFile(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M4 1.5h5l3.5 3.5v9.5H4z" />
    </IconShell>
  );
}

export function IconTerminal(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M2 2.5h12v11H2zM3.2 3.7h9.6v8.6H3.2z" />
      <path d="m5.3 8 2.4-2.4-1-1L4.3 7l2.4 2.4 1-1zM8.4 9.4h3.4v1.3H8.4z" />
    </IconShell>
  );
}

export function IconThought(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M8 1.5a4 4 0 0 0-2.6 7.1c.6.5.9 1.1 1 1.7h3.2c.1-.6.4-1.2 1-1.7A4 4 0 0 0 8 1.5Z" />
      <path d="M6.6 10.8h2.8v1.3H6.6zM7.2 12.8h1.6v1.3H7.2z" />
    </IconShell>
  );
}

export function IconSystem(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M2 2h12v12H2zM3.4 3.4h9.2v2.6H3.4zM3.4 7h9.2v2H3.4zM3.4 10h9.2v2.6H3.4z" />
    </IconShell>
  );
}

/** 指标（4）— 快 / 准 / 稳 / 省 */

export function IconSpeed(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M9 1 3.5 9h3L6 15l5.5-8h-3L9 1Z" />
    </IconShell>
  );
}

export function IconAccuracy(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M8 1.5 13 3.5v4.6c0 3-2 5.2-5 6.4-3-1.2-5-3.4-5-6.4V3.5L8 1.5Zm-1.7 6.4 1.3 1.3 2.7-2.7-1.1-1.1-1.6 1.6-.6-.6-1.1 1.1Z" />
    </IconShell>
  );
}

export function IconStability(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2 8h2V13H2zM6 3h2v10H6zM10 5.5h2v7.5h-2z" />
    </IconShell>
  );
}

export function IconCost(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Z" />
      <path d="M5.6 6.8h4.8v1.4H5.6zM5.6 9.2h4.8v1.4H5.6z" />
    </IconShell>
  );
}

/** 操作（12） */

export function IconSearch(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M6.5 2.5a4 4 0 1 0 2.3 7.2l2.4 2.4 1.1-1.1-2.4-2.4A4 4 0 0 0 6.5 2.5Zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
      <path d="M9.4 8.2 13.8 12.6 12.6 13.8 8.2 9.4Z" />
    </IconShell>
  );
}

export function IconFilter(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2 2h12l-4.6 5.4V13l-2.8-1.5V7.4L2 2Z" />
    </IconShell>
  );
}

export function IconRefresh(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.4 1.2 14.4 3.9 11.9 6.5 9.4 4.1Z" />
    </IconShell>
  );
}

export function IconCopy(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2.5 2.5h8v7h-8z" />
      <path d="M5.5 5.5h8v8h-8z" />
    </IconShell>
  );
}

export function IconDownload(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M7 1.5h2v4.6l1.8-1.8 1.2 1.2L8 9.3 4 5.5l1.2-1.2L7 6.1V1.5Z" />
      <path d="M2.5 11h11v3.5h-11z" />
    </IconShell>
  );
}

export function IconExternalLink(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M2 2h12v12H2zM3.4 3.4v9.2h9.2V8.6h-1.6v2.4H5V5h2.4V3.4H3.4Z" />
      <path d="M8.6 3.4H12.6V7.4H11V5.8L7 9.8 5.9 8.7l4-4H8.6V3.4Z" />
    </IconShell>
  );
}

export function IconTrash(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M4.6 1.5h6.8v1.7H4.6zM2.6 4h10.8v1.7H2.6z" />
      <path fillRule="evenodd" d="M3.5 6.6h9v8H3.5zM6.3 7.6h1.3v5.8H6.3zM8.4 7.6h1.3v5.8H8.4z" />
    </IconShell>
  );
}

export function IconClose(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M3.6 3.6 12.4 12.4 11.4 13.4 2.6 4.6Z" />
      <path d="M12.4 3.6 3.6 12.4 4.6 13.4 13.4 4.6Z" />
    </IconShell>
  );
}

export function IconChevronRight(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M5.5 2.5 11 8l-5.5 5.5-1-1L9 8 4.5 3.5l1-1Z" />
    </IconShell>
  );
}

export function IconChevronDown(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M2.5 5.5 8 11l5.5-5.5-1-1L8 9 3.5 4.5l-1 1Z" />
    </IconShell>
  );
}

export function IconKebab(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M6.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM6.5 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM6.5 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </IconShell>
  );
}

export function IconPlus(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M7 2h2v5h5v2H9v5H7V9H2V7h5z" />
    </IconShell>
  );
}

/** 其它（5） */

export function IconGear(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M7 1.2h2v2.4H7zM7 12.4h2v2.4H7zM1.2 7h2.4v2H1.2zM12.4 7h2.4v2h-2.4zM8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
    </IconShell>
  );
}

export function IconGlobe(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8ZM2.7 7.2h10.6v1.6H2.7zM7.2 2.8c-1.1 1.3-1.8 3.1-1.8 5.2s.7 3.9 1.8 5.2c1.1-1.3 1.8-3.1 1.8-5.2s-.7-3.9-1.8-5.2Z" />
    </IconShell>
  );
}

export function IconSun(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </IconShell>
  );
}

export function IconMoon(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M1.5 8a6.5 6.5 0 0 0 6.5 6.5c2.9 0 5.4-1.9 6.2-4.6a5.5 5.5 0 0 1-7.1-7.1A6.6 6.6 0 0 0 1.5 8Z" />
    </IconShell>
  );
}

export function IconDeviceDesktop(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M2 2h12v8.5H2zM3.3 3.3v5.9h9.4V3.3H3.3Z" />
      <path d="M7 11.8h2v1.5h3v1.4H4v-1.4h3z" />
    </IconShell>
  );
}

/** 主题切换：一半填充的圆形，直观表达亮色/暗色对比。 */
export function IconContrast(props: IconProps): React.JSX.Element {
  return (
    <IconShell {...props}>
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13A6.5 6.5 0 0 0 8 1.5Zm0 1.6v9.8a4.9 4.9 0 0 0 0-9.8Z" />
    </IconShell>
  );
}
