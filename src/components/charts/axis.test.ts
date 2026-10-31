import {describe,it,expect} from 'vitest';
import {niceAxis} from './axis.js';
describe('shared nice-number axis',()=>{
  it.each([[58.5,[0,20,40,60,80]],[19.5,[0,5,10,15,20]],[43.5,[0,20,40,60,80]],[7800,[0,2000,4000,6000,8000]],[.195,[0,.05,.1,.15,.2]]] as const)('rounds %s onto 1/2/5 steps', (maximum,ticks)=>{expect(niceAxis(maximum).ticks).toEqual(ticks);expect(niceAxis(maximum).max).toBeGreaterThanOrEqual(maximum);});
  it.each([0,NaN,Infinity,-1])('always returns a finite nonzero domain for %s',maximum=>{expect(niceAxis(maximum).max).toBeGreaterThan(0);expect(Number.isFinite(niceAxis(maximum).step)).toBe(true);});
});
