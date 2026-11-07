import test from 'node:test';
import assert from 'node:assert/strict';
import {Ordered} from './ordered.mjs';
class Meter {
  #rows=new Map();accesses=0;#keys;#budget=Infinity;
  constructor(keys){this.#keys=keys;}
  begin(budget){this.accesses=0;this.#budget=budget;}
  tick(){this.accesses++;assert.ok(this.accesses<=this.#budget,'slot operation budget');}
  read(handle){this.tick();assert.ok(this.#rows.has(handle),'missing slot');return {...this.#rows.get(handle)};}
  write(handle,value){assert.ok(Object.keys(value).length<=16,'flat slot bound');for(const v of Object.values(value))if(v!==null&&typeof v==='object')assert.ok(this.#keys.has(v),'only input key references may be nested');this.tick();this.#rows.set(handle,{...value});}
  drop(handle){this.tick();this.#rows.delete(handle);}
}

function checked(index,cells){
  assert.equal(cells.accesses,0,'construction must not access storage');
  return new Proxy(index,{get(target,name){
    if(['put','remove','rank','select','prefix'].includes(name))return (...args)=>{
      const before=target.size;
      cells.begin(128*Math.ceil(Math.log2(before+3)));
      const result=Reflect.apply(target[name],target,args);
      assert.ok(cells.accesses<=128*Math.ceil(Math.log2(Math.max(before,target.size)+2)),'slot operation budget');
      if(name==='remove'&&!result)assert.equal(cells.accesses,0);
      return result;
    };
    return Reflect.get(target,name,target);
  }});
}
test("orderbook-interaction-000", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=1;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-001", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=2;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-002", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=3;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-003", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=4;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-004", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=5;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-005", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=6;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-006", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=7;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-007", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=8;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-008", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=9;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-009", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=10;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-010", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=11;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-011", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=12;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-012", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=13;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-013", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=14;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-014", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=15;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-015", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=16;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-016", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=17;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-017", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=18;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-018", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=19;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-019", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=20;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-020", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=21;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-021", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=22;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-022", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=23;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-023", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=24;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-024", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=25;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-025", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=26;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-026", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=27;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-027", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=28;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-028", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=29;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-029", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=30;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-030", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=31;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-031", async () => {
let calls=0;const values=new WeakMap();const key=v=>{const k=Object.freeze({});values.set(k,v);return k;};const cmp=(a,b)=>{calls++;return values.get(a)-values.get(b);};
const cells=new Meter(values);const x=checked(new Ordered(cmp,cells),cells);const model=new Map();let serial=0;let state=32;const rand=()=>state=(state*1664525+1013904223)>>>0;
for(let step=0;step<240;step++){const id='i'+(rand()%65);const v=rand()%11;const weight=rand()%23-11;if(step%4===0){assert.equal(x.remove(id),model.delete(id));}else{x.put(id,key(v),weight);model.set(id,{id,v,weight,serial:model.get(id)?.serial??serial++});}
const rows=[...model.values()].sort((a,b)=>a.v-b.v||a.serial-b.serial);assert.equal(x.size,rows.length);for(let i=-1;i<=rows.length;i++)assert.equal(x.select(i),rows[i]?.id??null);for(let i=0;i<=rows.length+1;i++)assert.equal(x.prefix(i),rows.slice(0,i).reduce((s,r)=>s+r.weight,0));for(let i=0;i<12;i++){assert.equal(x.rank(key(i)),rows.filter(r=>r.v<i).length);assert.equal(x.rank(key(i),true),rows.filter(r=>r.v<=i).length);}}

});
test("orderbook-interaction-032", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=256;for(let i=0;i<n;i++)x.put(String(i),key(i),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
test("orderbook-interaction-033", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=256;for(let i=0;i<n;i++)x.put(String(i),key(n-i),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
test("orderbook-interaction-034", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=256;for(let i=0;i<n;i++)x.put(String(i),key(i%7),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
test("orderbook-interaction-035", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=1024;for(let i=0;i<n;i++)x.put(String(i),key(i),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
test("orderbook-interaction-036", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=1024;for(let i=0;i<n;i++)x.put(String(i),key(n-i),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
test("orderbook-interaction-037", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=1024;for(let i=0;i<n;i++)x.put(String(i),key(i%7),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
test("orderbook-interaction-038", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=4096;for(let i=0;i<n;i++)x.put(String(i),key(i),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
test("orderbook-interaction-039", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=4096;for(let i=0;i<n;i++)x.put(String(i),key(n-i),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
test("orderbook-interaction-040", async () => {
let count=0;const values=new WeakMap();const key=v=>{const o=Object.freeze({});values.set(o,v);return o;};const cells=new Meter(values);const x=checked(new Ordered((a,b)=>{count++;return values.get(a)-values.get(b);},cells),cells);const n=4096;for(let i=0;i<n;i++)x.put(String(i),key(i%7),i-17);assert.ok(count<=96*n*Math.ceil(Math.log2(n+2)));assert.ok(cells.accesses<=128*n*Math.ceil(Math.log2(n+2)));
for(let i=0;i<100;i++){count=0;cells.accesses=0;x.rank(key(i));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"rank cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'rank comparisons '+count);count=0;cells.accesses=0;x.put(String(i),key(n+i),-i);assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"put cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'update comparisons '+count);count=0;cells.accesses=0;x.remove(String(n-i-1));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"remove cell budget");assert.ok(count<=96*Math.ceil(Math.log2(n+2)),'remove comparisons '+count);cells.accesses=0;x.prefix(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"prefix cell budget");cells.accesses=0;x.select(Math.floor(x.size/2));assert.ok(cells.accesses<=128*Math.ceil(Math.log2(n+2)),"select cell budget");assert.equal(x.select(-1),null);}

});
