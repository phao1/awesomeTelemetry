import test from 'node:test';
import assert from 'node:assert/strict';
async function settled(p) { let state='pending', value; p.then(v=>{state='ok';value=v;},e=>{state='error';value=e;}); await Promise.resolve(); assert.notEqual(state,'pending','promise must settle after scheduler flush'); if(state==='error')throw value;return value;}
import {Pool} from './pool.mjs';import {Clock} from './clock.mjs';
test("reservoir-interaction-000", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire(1,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,1);}else{assert.equal(seen[0].weight,1);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,1);}
assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-001", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire(1,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,1);}else{assert.equal(seen[0].weight,1);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,1);}
assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-002", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire(1,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);a.cancel();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,1);}else{assert.equal(seen[0].weight,1);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,1);}
assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-003", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire(1,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);a.cancel();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,1);}else{assert.equal(seen[0].weight,1);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,1);}
assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-004", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire(1,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);p.close();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,1);}else{assert.equal(seen[0].weight,1);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,1);}
assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-005", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire(1,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);p.close();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,1);}else{assert.equal(seen[0].weight,1);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,1);}
assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-006", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire(1,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);a.cancel();p.close();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,1);}else{assert.equal(seen[0].weight,1);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,1);}
assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-007", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire(1,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);a.cancel();p.close();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,1);}else{assert.equal(seen[0].weight,1);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,1);}
assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-008", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,2);}else{assert.equal(seen[0].weight,2);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,2);}
assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-009", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,2);}else{assert.equal(seen[0].weight,2);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,2);}
assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-010", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);a.cancel();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,2);}else{assert.equal(seen[0].weight,2);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,2);}
assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-011", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);a.cancel();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,2);}else{assert.equal(seen[0].weight,2);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,2);}
assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-012", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);p.close();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,2);}else{assert.equal(seen[0].weight,2);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,2);}
assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-013", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);p.close();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,2);}else{assert.equal(seen[0].weight,2);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,2);}
assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-014", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);a.cancel();p.close();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,2);}else{assert.equal(seen[0].weight,2);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,2);}
assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-015", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);a.cancel();p.close();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,2);}else{assert.equal(seen[0].weight,2);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,2);}
assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-016", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,3);}else{assert.equal(seen[0].weight,3);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,3);}
assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-017", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,3);}else{assert.equal(seen[0].weight,3);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,3);}
assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-018", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);a.cancel();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,3);}else{assert.equal(seen[0].weight,3);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,3);}
assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-019", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);a.cancel();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,3);}else{assert.equal(seen[0].weight,3);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,3);}
assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-020", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);p.close();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,3);}else{assert.equal(seen[0].weight,3);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,3);}
assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-021", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);p.close();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,3);}else{assert.equal(seen[0].weight,3);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,3);}
assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-022", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);a.cancel();p.close();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,3);}else{assert.equal(seen[0].weight,3);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,3);}
assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-023", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);a.cancel();p.close();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,3);}else{assert.equal(seen[0].weight,3);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,3);}
assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-024", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,5);}else{assert.equal(seen[0].weight,5);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,5);}
assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-025", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,5);}else{assert.equal(seen[0].weight,5);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,5);}
assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-026", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);a.cancel();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,5);}else{assert.equal(seen[0].weight,5);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,5);}
assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-027", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);a.cancel();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,5);}else{assert.equal(seen[0].weight,5);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,5);}
assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-028", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);p.close();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,5);}else{assert.equal(seen[0].weight,5);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,5);}
assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-029", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);p.close();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,5);}else{assert.equal(seen[0].weight,5);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,5);}
assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-030", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[0]);a.cancel();p.close();c.flush();await Promise.resolve();
if(0===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,5);}else{assert.equal(seen[0].weight,5);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,5);}
assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-031", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5,0);const seen=[];a.promise.then(r=>seen.push(r),e=>seen.push(e.message));
const ids=c.ready();c.step(ids[1]);a.cancel();p.close();c.flush();await Promise.resolve();
if(1===0){assert.deepEqual(seen,['timeout']);assert.equal(p.stats().free,5);}else{assert.equal(seen[0].weight,5);assert.equal(a.cancel(),false);assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);assert.equal(p.stats().free,5);}
assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-032", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2);const b=p.acquire();const errors=[];a.promise.catch(e=>errors.push(e.message));b.promise.catch(e=>errors.push(e.message));p.close();c.flush();await Promise.resolve();assert.deepEqual(errors,['closed','closed']);assert.deepEqual(p.stats(),{free:2,waiting:0,held:0});
});
test("reservoir-interaction-033", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2);a.promise.catch(()=>{});assert.equal(a.cancel(),true);assert.equal(a.cancel(),false);const b=p.acquire(2);c.flush();const r=await settled(b.promise);assert.deepEqual(p.stats(),{free:0,waiting:0,held:2});r.release();assert.equal(p.stats().free,2);
});
test("reservoir-interaction-034", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3);const b=p.acquire();const errors=[];a.promise.catch(e=>errors.push(e.message));b.promise.catch(e=>errors.push(e.message));p.close();c.flush();await Promise.resolve();assert.deepEqual(errors,['closed','closed']);assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-035", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(3);a.promise.catch(()=>{});assert.equal(a.cancel(),true);assert.equal(a.cancel(),false);const b=p.acquire(3);c.flush();const r=await settled(b.promise);assert.deepEqual(p.stats(),{free:0,waiting:0,held:3});r.release();assert.equal(p.stats().free,3);
});
test("reservoir-interaction-036", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5);const b=p.acquire();const errors=[];a.promise.catch(e=>errors.push(e.message));b.promise.catch(e=>errors.push(e.message));p.close();c.flush();await Promise.resolve();assert.deepEqual(errors,['closed','closed']);assert.deepEqual(p.stats(),{free:5,waiting:0,held:0});
});
test("reservoir-interaction-037", async () => {
const c=new Clock();const p=new Pool(5,c);const a=p.acquire(5);a.promise.catch(()=>{});assert.equal(a.cancel(),true);assert.equal(a.cancel(),false);const b=p.acquire(5);c.flush();const r=await settled(b.promise);assert.deepEqual(p.stats(),{free:0,waiting:0,held:5});r.release();assert.equal(p.stats().free,5);
});
test("reservoir-interaction-038", async () => {
const c=new Clock();const p=new Pool(3,c);const a=p.acquire(2);c.flush();const r=await settled(a.promise);const b=p.acquire(2);const d=p.acquire(1);assert.deepEqual(p.stats(),{free:1,waiting:2,held:2});b.promise.catch(()=>{});b.cancel();c.flush();const s=await settled(d.promise);r.release();s.release();assert.deepEqual(p.stats(),{free:3,waiting:0,held:0});
});
test("reservoir-interaction-039", async () => {
const c=new Clock();const p=new Pool(2,c);const a=p.acquire(2);c.flush();const r=await settled(a.promise);p.close();assert.equal(a.cancel(),false);assert.equal(r.release(),true);const b=p.acquire();await assert.rejects(settled(b.promise),/closed/);assert.equal(p.stats().free,2);
});
test("reservoir-interaction-040", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire();c.flush();const r=await settled(a.promise);const b=p.acquire(1,0);b.promise.catch(()=>{});r.release();const ids=c.ready();c.step(ids[0]);c.flush();await assert.rejects(settled(b.promise),/timeout/);assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
});
test("reservoir-interaction-041", async () => {
const c=new Clock();assert.throws(()=>new Pool(0,c),RangeError);const p=new Pool(2,c);for(const w of [0,3,1.5])assert.throws(()=>p.acquire(w),RangeError);assert.throws(()=>p.acquire(1,-1),RangeError);
});
test("reservoir-interaction-042", async () => {
const c=new Clock();const p=new Pool(1,c);const a=p.acquire();a.promise.then(r=>r.release());c.flush();await Promise.resolve();const b=p.acquire();c.flush();(await settled(b.promise)).release();assert.equal(p.stats().free,1);
});
test('reservoir-exhaustive-ready-orders', async()=>{
  for(let seed=0;seed<81;seed++) {
    const c=new Clock(),p=new Pool(1,c);
    const a=p.acquire();c.flush();const owner=await settled(a.promise);
    const b=p.acquire();const seen=[];b.promise.then(r=>seen.push(r),e=>seen.push(e.message));
    let aHeld=true,bState='waiting',closed=false;
    const actions=new Map();
    actions.set(c.defer(()=>owner.release()),'release');
    actions.set(c.defer(()=>b.cancel()),'cancel');
    actions.set(c.defer(()=>p.close()),'close');
    let choices=seed;
    while(c.ready().length) {
      const ids=c.ready();const id=ids[choices%ids.length];choices=Math.floor(choices/ids.length);
      const action=actions.get(id);
      if(action==='release') {aHeld=false;if(bState==='waiting'&&!closed)bState='reserved';}
      else if(action==='cancel') {if(bState==='waiting'||bState==='reserved')bState='cancelled';}
      else if(action==='close') {closed=true;if(bState==='waiting'||bState==='reserved')bState='closed';}
      else if(bState==='reserved') bState='held';
      c.step(id);await Promise.resolve();
      const held=Number(aHeld)+Number(bState==='reserved'||bState==='held');
      assert.deepEqual(p.stats(),{free:1-held,held,waiting:Number(bState==='waiting')});
      if(bState==='held')assert.equal(seen[0]?.weight,1);
      else if(bState==='cancelled'||bState==='closed')assert.deepEqual(seen,[bState]);
      else assert.deepEqual(seen,[]);
    }
    if(bState==='held'){assert.equal(seen[0].release(),true);assert.equal(seen[0].release(),false);}
    assert.deepEqual(p.stats(),{free:1,waiting:0,held:0});
  }
});
