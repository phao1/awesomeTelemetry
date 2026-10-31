import type { ChartSlice,ChartTone } from './types.js';
import { BarChart } from './BarChart.js';
export interface HistogramProps {buckets:ChartSlice[];tone?:ChartTone;width?:number;height?:number;}
export function Histogram({buckets,tone,...props}:HistogramProps):React.JSX.Element {return <BarChart {...props} label="histogram" labels={buckets.map(b=>b.label)} series={[{label:'Count / 数量',points:buckets.map(b=>b.value),color:tone?`var(--${tone}-emphasis)`:undefined}]}/>;}
