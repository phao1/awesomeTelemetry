import { useEffect, useState, type ReactNode } from 'react';

import { SplitPane } from '../ui/SplitPane.js';
import { LAYOUT_KEYS, LAYOUT_RANGES, loadNumber } from '../../layout.js';

export interface TrajectoryRailProps {
  /** 上下文 rail 内容（AgentHierarchyPanel）。 */
  rail: ReactNode;
  /** turn 区域（TrajectoryStatBar + TurnRibbon + TurnList…）。 */
  turnArea: ReactNode;
  /** 用户主动折叠（[ 键 / rail 头按钮）。 */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** D2：<1024px 视口自动折叠 rail，turn 区域保持可用。 */
const NARROW_QUERY = '(max-width: 1023px)';

/**
 * D2 TrajectoryRail：复用现有 SplitPane atom，宽度 240–300 钳制并持久化
 * （awesome-telemetry.trajectory.railWidth，D18）；<1024px 自动折叠，
 * 不禁用 turn 区域。
 */
export function TrajectoryRail({
  rail,
  turnArea,
  collapsed,
  onToggleCollapse,
}: TrajectoryRailProps): React.JSX.Element {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(NARROW_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const railCollapsed = collapsed || narrow;
  const initialWidth = loadNumber(
    LAYOUT_KEYS.trajectoryRailWidth,
    260,
    LAYOUT_RANGES.trajectoryRailWidth,
  );

  return (
    <div className="trajectory-body">
      <SplitPane
        direction="horizontal"
        initialSize={railCollapsed ? 0 : initialWidth}
        min={240}
        max={300}
        // 折叠时跳过 storageKey：SplitPane 的 loadSize 会用旧值覆盖 initialSize=0。
        storageKey={railCollapsed ? undefined : LAYOUT_KEYS.trajectoryRailWidth}
        firstClassName="trajectory-rail-pane"
        secondClassName="trajectory-area-pane"
        first={
          <div className="trajectory-rail">
            <div className="rail-header">
              <button
                type="button"
                className="ui-icon-btn ui-btn-sm"
                aria-label="collapse rail"
                onClick={onToggleCollapse}
              >
                <span aria-hidden="true">⇤</span>
              </button>
            </div>
            {rail}
          </div>
        }
        second={<div className="trajectory-area">{turnArea}</div>}
      />
    </div>
  );
}
