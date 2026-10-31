import type { TaskKpis, TaskSummary } from './task-types.js';
export type OverviewRange = '24h' | '7d' | '30d' | 'all';
export interface OverviewPoint extends TaskKpis {
  day: string;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}
export interface OverviewSnapshot {
  range: OverviewRange;
  provider: string;
  generatedAt: string;
  current: OverviewPoint;
  previous: OverviewPoint | null;
  daily: OverviewPoint[];
  providers: Array<{ label: string; value: number }>;
  models: Array<{ label: string; value: number }>;
  tools: Array<{ tool: string; failures: number; results: number }>;
  alerts: TaskSummary[];
  criteria: Record<'zh' | 'en', string>;
}
