import { useEffect, useMemo, useRef, useState } from 'react';

import type { Locale, I18nKey } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { MessageRole, TurnModel } from '../../core/trace-types.js';
import {
  computeRibbon,
  type RibbonMode,
} from '../../core/turn-ribbon.js';
import {
  IconChevronDown,
  IconCommand,
  IconGear,
  IconMessage,
  IconThought,
  IconTool,
  type IconProps,
} from '../icons/index.js';

export interface TurnRibbonProps {
  model: TurnModel;
  mode: RibbonMode;
  locale: Locale;
  /** 当前高亮回合（turn-list 滚动同步，top-most fully visible，D10）。 */
  activeTurnIndex?: number | null;
  /** 激活某段 → 滚动到该回合并展开；不发起任何请求（D16）。 */
  onActivate: (turnIndex: number) => void;
}

const LEGEND: Array<{
  role: MessageRole;
  labelKey: I18nKey;
  icon: (props: IconProps) => React.JSX.Element;
}> = [
  { role: 'system', labelKey: 'trajectory.ribbon.legend.system', icon: IconGear },
  { role: 'user', labelKey: 'trajectory.ribbon.legend.user', icon: IconCommand },
  { role: 'assistant', labelKey: 'trajectory.ribbon.legend.assistant', icon: IconMessage },
  { role: 'tool', labelKey: 'trajectory.ribbon.legend.tool', icon: IconTool },
  { role: 'reasoning', labelKey: 'trajectory.ribbon.legend.reasoning', icon: IconThought },
  { role: 'compact', labelKey: 'trajectory.ribbon.legend.compact', icon: IconChevronDown },
];

const ROLE_SWATCH: Record<MessageRole, string> = {
  system: 'var(--role-system-fg)',
  user: 'var(--role-user-fg)',
  assistant: 'var(--role-assistant-fg)',
  tool: 'var(--role-tool-fg)',
  reasoning: 'var(--role-reasoning-fg)',
  compact: 'var(--role-compact-fg)',
  subagent: 'var(--neutral-fg)',
};

/**
 * D10 TurnRibbon：`computeRibbon` 的纯几何结果一次 React commit 渲染。
 * 图例 = swatch + icon + name（颜色不单独承载含义）；段是 button，可键盘激活。
 * 高亮写回 top-most turn（rAF 节流在 TurnList 侧）；激活段零请求。
 */
export function TurnRibbon({
  model,
  mode,
  locale,
  activeTurnIndex = null,
  onActivate,
}: TurnRibbonProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) {
      return;
    }
    const measure = (): void => {
      if (el.clientWidth > 0) {
        setWidthPx(el.clientWidth);
      }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    return;
  }, []);

  const ribbon = useMemo(
    () => computeRibbon(model.turns, mode, widthPx),
    [model.turns, mode, widthPx],
  );

  if (model.turns.length === 0) {
    return <div className="turn-ribbon" ref={containerRef} />;
  }

  return (
    <div className="turn-ribbon" ref={containerRef}>
      <div className="turn-ribbon-segments" role="group" aria-label={t('trajectory.ribbon.modeGroup', locale)}>
        {ribbon.segments.map((segment, index) => {
          const active =
            activeTurnIndex !== null && segment.turnIndices.includes(activeTurnIndex);
          const background =
            segment.dominantRole === null
              ? 'var(--neutral-fg)'
              : ROLE_SWATCH[segment.dominantRole];
          return (
            <button
              key={index}
              type="button"
              className={`turn-ribbon-segment ${active ? 'turn-ribbon-segment-active' : ''}`}
              style={{ width: segment.widthPx, background }}
              aria-label={segment.ariaLabel}
              title={segment.ariaLabel}
              onClick={() => onActivate(segment.turnIndices[0]!)}
            />
          );
        })}
      </div>
      <ul className="turn-ribbon-legend">
        {LEGEND.map((entry) => {
          const Icon = entry.icon;
          return (
            <li key={entry.role} className="turn-ribbon-legend-item">
              <span
                className="turn-ribbon-swatch"
                style={{ background: ROLE_SWATCH[entry.role] }}
                aria-hidden="true"
              />
              <Icon size={12} />
              <span>{t(entry.labelKey, locale)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
