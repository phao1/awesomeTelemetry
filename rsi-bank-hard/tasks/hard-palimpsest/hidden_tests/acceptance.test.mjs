import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from './database.mjs';
test("palimpsest-interaction-000", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('a',0);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-001", async () => {
const d=new Database();const x=d.begin();x.get('a');const y=d.begin();y.put('a',0);y.commit();const z=d.begin();z.delete('a');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-002", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('a');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('a',0);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-003", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('b',1);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-004", async () => {
const d=new Database();const x=d.begin();x.get('b');const y=d.begin();y.put('b',1);y.commit();const z=d.begin();z.delete('b');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-005", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('b');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('b',1);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-006", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('c',2);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-007", async () => {
const d=new Database();const x=d.begin();x.get('c');const y=d.begin();y.put('c',2);y.commit();const z=d.begin();z.delete('c');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-008", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('c');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('c',2);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-009", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('d',3);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-010", async () => {
const d=new Database();const x=d.begin();x.get('d');const y=d.begin();y.put('d',3);y.commit();const z=d.begin();z.delete('d');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-011", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('d');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('d',3);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-012", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('e',4);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-013", async () => {
const d=new Database();const x=d.begin();x.get('e');const y=d.begin();y.put('e',4);y.commit();const z=d.begin();z.delete('e');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-014", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('e');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('e',4);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-015", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('f',5);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-016", async () => {
const d=new Database();const x=d.begin();x.get('f');const y=d.begin();y.put('f',5);y.commit();const z=d.begin();z.delete('f');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-017", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('f');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('f',5);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-018", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('g',6);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-019", async () => {
const d=new Database();const x=d.begin();x.get('g');const y=d.begin();y.put('g',6);y.commit();const z=d.begin();z.delete('g');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-020", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('g');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('g',6);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-021", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('h',7);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-022", async () => {
const d=new Database();const x=d.begin();x.get('h');const y=d.begin();y.put('h',7);y.commit();const z=d.begin();z.delete('h');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-023", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('h');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('h',7);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-024", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('i',8);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-025", async () => {
const d=new Database();const x=d.begin();x.get('i');const y=d.begin();y.put('i',8);y.commit();const z=d.begin();z.delete('i');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-026", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('i');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('i',8);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-027", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('j',9);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-028", async () => {
const d=new Database();const x=d.begin();x.get('j');const y=d.begin();y.put('j',9);y.commit();const z=d.begin();z.delete('j');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-029", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('j');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('j',9);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-030", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('k',10);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-031", async () => {
const d=new Database();const x=d.begin();x.get('k');const y=d.begin();y.put('k',10);y.commit();const z=d.begin();z.delete('k');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-032", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('k');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('k',10);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-033", async () => {
const d=new Database({a:1,z:9});const x=d.begin(); x.scan('a','z');const y=d.begin();y.put('l',11);y.commit(); assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-034", async () => {
const d=new Database();const x=d.begin();x.get('l');const y=d.begin();y.put('l',11);y.commit();const z=d.begin();z.delete('l');z.commit();assert.deepEqual(x.commit(),{ok:false,epoch:2});
});
test("palimpsest-interaction-035", async () => {
const d=new Database({a:0});const x=d.begin();x.savepoint('s');x.get('l');x.scan(null,null);x.put('q',7);x.rollback('s');const y=d.begin();y.put('l',11);y.commit();assert.deepEqual(x.commit(),{ok:true,epoch:1});assert.equal(d.begin().get('q'),null);
});
test("palimpsest-interaction-036", async () => {
const d=new Database({a:1});const x=d.begin();x.put('b',2);x.delete('a');assert.deepEqual(x.scan(),[['b',2]]);assert.deepEqual(x.commit(),{ok:true,epoch:1});
});
test("palimpsest-interaction-037", async () => {
const d=new Database();const x=d.begin();x.scan('a','b');const y=d.begin();y.put('b',2);y.commit();assert.equal(x.commit().ok,true);
});
test("palimpsest-interaction-038", async () => {
const d=new Database();const x=d.begin();x.scan('a','a');const y=d.begin();y.put('a',2);y.commit();assert.equal(x.commit().ok,true);
});
test("palimpsest-interaction-039", async () => {
const d=new Database();const x=d.begin();x.put('a',1);x.savepoint('s');x.put('a',2);x.savepoint('s');x.put('a',3);x.rollback('s');assert.equal(x.get('a'),2);x.release('s');x.rollback('s');assert.equal(x.get('a'),1);
});
test("palimpsest-interaction-040", async () => {
const d=new Database();const x=d.begin();x.savepoint('a');x.put('x',1);x.savepoint('b');x.release('a');assert.throws(()=>x.rollback('b'));assert.equal(x.get('x'),1);
});
test("palimpsest-interaction-041", async () => {
const d=new Database();const x=d.begin();x.put('a',1);x.put('b',2);const y=d.begin();y.put('a',3);y.commit();assert.equal(x.commit().ok,false);assert.equal(d.begin().get('b'),null);
});
test("palimpsest-interaction-042", async () => {
const d=new Database({a:{x:1}});const x=d.begin();const y=d.begin();y.put('a',2);y.commit();assert.deepEqual(x.get('a'),{x:1});assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-043", async () => {
const d=new Database();const x=d.begin();const value={a:[1]};x.put('',value);value.a.push(2);x.get('').a.push(3);x.scan()[0][1].a.push(4);assert.deepEqual(x.get(''),{a:[1]});
});
test("palimpsest-interaction-044", async () => {
const d=new Database();const x=d.begin();x.delete('absent');assert.equal(x.commit().epoch,1);assert.equal(d.begin().commit().epoch,1);
});
test("palimpsest-interaction-045", async () => {
const d=new Database();const x=d.begin();x.abort();for(const op of [()=>x.get('a'),()=>x.put('a',1),()=>x.delete('a'),()=>x.scan(),()=>x.savepoint('a'),()=>x.rollback('a'),()=>x.release('a'),()=>x.commit(),()=>x.abort()])assert.throws(op);
});
test("palimpsest-interaction-046", async () => {
const d=new Database();const x=d.begin();assert.throws(()=>x.scan('z','a'),RangeError);assert.throws(()=>x.get(1),TypeError);assert.throws(()=>x.put('a',undefined),TypeError);assert.equal(x.commit().ok,true);
});
test("palimpsest-interaction-047", async () => {
const d=new Database();const x=d.begin();x.savepoint('s');x.scan();x.rollback('s');x.scan('b','c');const y=d.begin();y.put('a',2);y.commit();assert.equal(x.commit().ok,true);
});
test("palimpsest-interaction-048", async () => {
const d=new Database();const x=d.begin();x.scan();const y=d.begin();y.delete('ghost');y.commit();assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-049", async () => {
const d=new Database();const x=d.begin();x.put('a',1);const y=d.begin();y.put('a',2);y.commit();assert.equal(x.get('a'),1);assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-050", async () => {
const d=new Database({a:false,b:null,c:0});const x=d.begin();assert.deepEqual(x.scan(),[['a',false],['b',null],['c',0]]);
});
test("palimpsest-interaction-051", async () => {
const d=new Database();const x=d.begin();x.get('a');x.savepoint('s');x.get('b');x.rollback('s');const y=d.begin();y.put('a',1);y.commit();assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-052", async () => {
const d=new Database({a:null});const x=d.begin();assert.equal(x.has('a'),true);assert.equal(x.has('b'),false);x.put('b',null);assert.equal(x.has('b'),true);x.delete('a');assert.equal(x.has('a'),false);x.abort();assert.throws(()=>x.has('a'));
});
test("palimpsest-interaction-053", async () => {
const d=new Database();const x=d.begin();assert.equal(x.has('a'),false);const y=d.begin();y.put('a',null);y.commit();assert.equal(x.commit().ok,false);
});
test("palimpsest-interaction-054", async () => {
const d=new Database();const x=d.begin();assert.throws(()=>x.has(1),TypeError);assert.equal(x.commit().ok,true);
});
test("palimpsest-boundary-000",async()=>{const x=new Database({a:1,b:2,c:3,z:4}).begin();assert.deepEqual(x.scan('a','c'),[['a',1],['b',2]]);assert.deepEqual(x.scan('b','b'),[]);assert.deepEqual(x.scan(null,'b'),[['a',1]]);assert.deepEqual(x.scan('z',null),[['z',4]]);});
test("palimpsest-boundary-001",async()=>{const x=new Database().begin();for(const op of [()=>x.put(1,2),()=>x.delete(1),()=>x.savepoint(1),()=>x.rollback(1),()=>x.release(1),()=>x.scan(1,null),()=>x.scan(null,1)])assert.throws(op,TypeError);assert.deepEqual(x.commit(),{ok:true,epoch:0});});
test("palimpsest-boundary-002",async()=>{const d=new Database({a:1,b:2});const x=d.begin();x.scan('a','b');const y=d.begin();y.put('a',3);y.commit();assert.equal(x.commit().ok,false);});
test("palimpsest-boundary-003",async()=>{const d=new Database({a:1,b:2});const x=d.begin();x.scan('a','b');const y=d.begin();y.put('b',3);y.commit();assert.equal(x.commit().ok,true);});
test("palimpsest-boundary-004",async()=>{const d=new Database({a:0});const old=d.begin();for(let i=1;i<9;i++){const t=d.begin();t.put('a',i);t.commit();}assert.equal(old.get('a'),0);assert.equal(old.commit().ok,false);assert.equal(d.begin().get('a'),8);});
test("palimpsest-boundary-005",async()=>{const initial={a:{x:[1]}};const d=new Database(initial);initial.a.x.push(2);const x=d.begin();x.scan()[0][1].x.push(3);assert.deepEqual(x.get('a'),{x:[1]});});
test("palimpsest-boundary-006",async()=>{const d=new Database();const x=d.begin();x.scan('a','c');x.savepoint('s');x.scan('x','z');x.rollback('s');const y=d.begin();y.delete('b');y.commit();assert.equal(x.commit().ok,false);});
test("palimpsest-boundary-007",async()=>{const d=new Database();const x=d.begin();x.scan('a','c');x.savepoint('s');x.scan('x','z');x.rollback('s');const y=d.begin();y.put('y',1);y.commit();assert.equal(x.commit().ok,true);});
