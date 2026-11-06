import { describe, expect, it } from 'vitest';
import { parseHash } from '../../hash-router.js';
import { parseRsiRoute, serializeRsiRoute } from './route.js';
describe('RSI shareable deep links',()=>{
  it.each(['#/rsi','#/rsi?view=review&filter=held','#/rsi?view=calibration&task=task-a','#/rsi?task=task-a&iter=3&tab=diff&file=src%2Fa.ts','#/rsi?task=task-a&iter=3&tab=runs&run=run-a&traceFile=last-request','#/rsi?create=1'])('round trips %s',hash=>{
    expect(parseHash(hash)?.view).toBe('rsi');const route=parseRsiRoute(hash);expect(parseRsiRoute(serializeRsiRoute(route))).toEqual(route);
  });
  it('rejects invalid task and iteration selectors without throwing',()=>{const route=parseRsiRoute('#/rsi?task=../secret&iter=-1&view=bad');expect(route).toMatchObject({task:null,iter:null,view:'tasks'});});
});
