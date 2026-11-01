import type { ChartTone, StackSeries } from './types.js';
import { AreaChart } from './AreaChart.js';
export interface StackedAreaChartProps {series:StackSeries[];width?:number;height?:number;tones?:ChartTone[];xLabels?:string[];}
export function StackedAreaChart({series,tones,...props}:StackedAreaChartProps):React.JSX.Element {return <AreaChart {...props} label="stacked area chart" stacked series={series.map((s,i)=>({...s,color:tones?.[i]?`var(--${tones[i]}-emphasis)`:undefined}))}/>;}
