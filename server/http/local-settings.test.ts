import {mkdtemp,readFile,rm,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {createLocalSettings,validateAlerts} from './local-settings.js';
import {DEFAULT_ALERT_THRESHOLDS} from '../../src/core/task-alerts.js';
let dir:string;
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'f1-settings-'));});
afterEach(async()=>{await rm(dir,{recursive:true,force:true});});
it('validates thresholds and rejects removed monetary rules',()=>{
 for(const patch of [{toolFailurePct:101},{errors:1.5},{costUSD:1},{costCNY:2}])expect(()=>validateAlerts({...DEFAULT_ALERT_THRESHOLDS,...patch})).toThrow();
 expect(validateAlerts(DEFAULT_ALERT_THRESHOLDS)).toEqual(DEFAULT_ALERT_THRESHOLDS);
});
it('atomically saves user thresholds with private permissions and persists disabled defaults',async()=>{
 const store=createLocalSettings(join(dir,'agent-observe.json'));expect(await store.alerts()).toEqual(DEFAULT_ALERT_THRESHOLDS);
 await store.saveAlerts({...DEFAULT_ALERT_THRESHOLDS,errors:1});
 expect((await createLocalSettings(join(dir,'agent-observe.json')).alerts()).errors).toBe(1);
 expect((await stat(join(dir,'alert-thresholds.json'))).mode&0o777).toBe(0o600);
 await store.saveAlerts(DEFAULT_ALERT_THRESHOLDS);expect(await store.alerts()).toEqual(DEFAULT_ALERT_THRESHOLDS);
});
it('does not overwrite corrupt user data',async()=>{
 await writeFile(join(dir,'alert-thresholds.json'),'{corrupt');
 await expect(createLocalSettings(join(dir,'agent-observe.json')).saveAlerts(DEFAULT_ALERT_THRESHOLDS)).rejects.toThrow();
 expect(await readFile(join(dir,'alert-thresholds.json'),'utf8')).toBe('{corrupt');
});
it('ignores even corrupt retired model configuration',async()=>{
 await writeFile(join(dir,'model-pricing.json'),'{corrupt');
 expect(await createLocalSettings(join(dir,'agent-observe.json')).alerts()).toEqual(DEFAULT_ALERT_THRESHOLDS);
});

it('discards retired rules from existing saved thresholds without activating them',async()=>{
 await writeFile(join(dir,'alert-thresholds.json'),JSON.stringify({...DEFAULT_ALERT_THRESHOLDS,errors:2,costUSD:1,costCNY:3}));
 const store=createLocalSettings(join(dir,'agent-observe.json'));
 expect(await store.alerts()).toEqual({...DEFAULT_ALERT_THRESHOLDS,errors:2});
 await store.saveAlerts(DEFAULT_ALERT_THRESHOLDS);
 expect(JSON.parse(await readFile(join(dir,'alert-thresholds.json'),'utf8'))).toEqual(DEFAULT_ALERT_THRESHOLDS);
});
