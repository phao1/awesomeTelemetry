import type { SessionDetailResponse, SpeedMetrics } from '../core/trace-types.js';

/** Compare 视图的共享结果形状（CompareBoard 与各子组件共用）。 */
export interface CompareResult {
  left: SessionDetailResponse;
  right: SessionDetailResponse;
  speed: { left: SpeedMetrics; right: SpeedMetrics };
}
