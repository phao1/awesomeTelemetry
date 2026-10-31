import {mkdtemp,readFile,rm,writeFile,mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {createLocalSettings,validatePrices,validateAlerts} from './local-settings.js';
import {DEFAULT_ALERT_THRESHOLDS} from '../../src/core/task-alerts.js';
import {lookupModelPrice,setModelPriceOverrides,modelPricingRevision} from '../../src/core/pricing.js';
let dir:string;
const price={input:1,output:2,cacheRead:0,cacheWrite:0,contextWindow:100,source:'fixture 2026-10-31',currency:'CNY'};
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'phaseb-settings-'));});
afterEach(async()=>{await rm(dir,{recursive:true,force:true});setModelPriceOverrides({});});
it('validates sources, finite nonnegative prices, all required fields, currency, model normalization and duplicate keys',()=>{
 expect(validatePrices({'anthropic.Model-20261031':price})).toEqual({model:price});
 for(const patch of [{source:''},{currency:'EUR'},{input:-1},{output:Infinity},{contextWindow:0},{bogus:1}])expect(()=>validatePrices({model:{...price,...patch}})).toThrow();
 const {source,...missing}=price;expect(source).toBeTruthy();expect(()=>validatePrices({model:missing})).toThrow();
 expect(()=>validatePrices({Model:price,model:price})).toThrow();
 expect(()=>validateAlerts({...DEFAULT_ALERT_THRESHOLDS,toolFailurePct:101})).toThrow();
 expect(()=>validateAlerts({...DEFAULT_ALERT_THRESHOLDS,errors:1.5})).toThrow();
 expect(validateAlerts(DEFAULT_ALERT_THRESHOLDS)).toEqual(DEFAULT_ALERT_THRESHOLDS);
});
it('preserves three-layer priority, atomically saves only user JSON, updates revision and persists disabled thresholds',async()=>{
 await mkdir(join(dir,'config'));await writeFile(join(dir,'config','model-pricing.json'),JSON.stringify({model:{...price,currency:'USD',input:9}}));
 const store=createLocalSettings(join(dir,'user','agent-observe.json'),dir);
 expect((await store.prices()).model!.input).toBe(9);expect(await store.alerts()).toEqual(DEFAULT_ALERT_THRESHOLDS);
 const before=modelPricingRevision();await store.savePrices({model:price});expect(modelPricingRevision()).toBeGreaterThan(before);expect(lookupModelPrice('Model')).toEqual(price);
 expect(JSON.parse(await readFile(join(dir,'user','model-pricing.json'),'utf8'))).toEqual({model:price});expect((await stat(join(dir,'user','model-pricing.json'))).mode&0o777).toBe(0o600);
 await store.saveAlerts({...DEFAULT_ALERT_THRESHOLDS,errors:1});const reopened=createLocalSettings(join(dir,'user','agent-observe.json'),dir);expect((await reopened.alerts()).errors).toBe(1);expect((await reopened.prices()).model).toEqual(price);
 expect(lookupModelPrice('missing')).toBeNull();
});
it('does not overwrite corrupt user data',async()=>{
 await writeFile(join(dir,'model-pricing.json'),'{corrupt');const store=createLocalSettings(join(dir,'agent-observe.json'),dir);
 await expect(store.savePrices({model:price})).rejects.toThrow();expect(await readFile(join(dir,'model-pricing.json'),'utf8')).toBe('{corrupt');
});
