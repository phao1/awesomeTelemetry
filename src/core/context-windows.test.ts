import {expect,it} from 'vitest';
import {lookupContextWindow,normalizeModelId} from './context-windows.js';
it('retains sourced context metadata with normalized vendor and date labels',()=>{
 expect(normalizeModelId('anthropic.claude-opus-4-8-20251101')).toBe('claude-opus-4-8');
 expect(lookupContextWindow('claude-opus-4-8[1m]')).toBe(1000000);
 expect(lookupContextWindow('claude-haiku-4-5')).toBe(200000);
 expect(lookupContextWindow('unknown')).toBeNull();expect(lookupContextWindow(null)).toBeNull();
});
