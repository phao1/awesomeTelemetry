import { StatCard } from '../../ui/Display.js';
import type { Locale } from '../../../i18n.js';
import type { HealthFinding } from '../../../core/task-health/types.js';
import { healthSeverity } from './health-copy.js';
export function HealthSeveritySummary({findings,locale}:{findings:HealthFinding[];locale:Locale}) {
 return <div className="health-stat-grid">{(['warning','notice','info'] as const).map(severity=><div key={severity} className={`health-severity health-severity-${severity}`}><StatCard label={healthSeverity(severity,locale)} value={findings.filter(f=>f.severity===severity).length}/></div>)}</div>;
}
