import { expectTypeOf, it } from 'vitest';
import type { HealthInput, HealthMetric, HealthReport } from './types.js';
import type { analyzeTaskHealth } from './report.js';
it('keeps the contracted entry point and required nullable fields', () => { expectTypeOf<Parameters<typeof analyzeTaskHealth>[0]>().toEqualTypeOf<HealthInput>(); expectTypeOf<ReturnType<typeof analyzeTaskHealth>>().toEqualTypeOf<HealthReport>(); expectTypeOf<HealthMetric['value']>().toEqualTypeOf<number | null>(); expectTypeOf<HealthInput['version']>().toEqualTypeOf<1>(); });
