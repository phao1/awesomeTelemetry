/** add-mission-control §8.1：7 个手写 SVG 图表原子的共享类型。0 新增依赖。 */

export type ChartTone = 'accent' | 'success' | 'attention' | 'danger' | 'neutral';

/** 排行条 / 环形图 / 直方图通用行。tone 缺省时用组件级 tone。 */
export interface ChartSlice {
  label: string;
  value: number;
  tone?: ChartTone;
}

/** 堆叠面积图序列。 */
export interface StackSeries {
  label: string;
  points: number[];
}
