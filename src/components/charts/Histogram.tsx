import type { Locale } from '../../i18n.js';
import { useComponentCopy } from '../ui/component-copy.js';
import type { ChartSlice,ChartTone } from './types.js';
import { BarChart } from './BarChart.js';
export interface HistogramProps {locale?:Locale;buckets:ChartSlice[];tone?:ChartTone;width?:number;height?:number;}
export function Histogram({buckets,tone,locale,...props}:HistogramProps):React.JSX.Element {const copy=useComponentCopy(locale);return <BarChart locale={locale} {...props} label="histogram" labels={buckets.map(b=>b.label)} series={[{label:copy.count,points:buckets.map(b=>b.value),color:tone?`var(--${tone}-emphasis)`:undefined}]}/>;}
