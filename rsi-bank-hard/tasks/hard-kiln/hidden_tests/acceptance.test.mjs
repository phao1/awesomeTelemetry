import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from './workspace.mjs';import {digest} from './digest.mjs';import {createHash} from 'node:crypto';
test("kiln-interaction-000", async () => {
const collision=new Workspace();assert.deepEqual(collision.build({'notes':'#text "tail"','notes#':'text "tail"'},[{name:'comment',entry:'notes',output:'comment'},{name:'literal',entry:'notes#',output:'literal'}]).outputs,{comment:'',literal:'tail'});

const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v0"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v0');files['widgets/title']='text "next0"';assert.equal(w.build(files,target).outputs.out,'next0');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-001", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v1"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v1');files['widgets/title']='text "next1"';assert.equal(w.build(files,target).outputs.out,'next1');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-002", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v2"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v2');files['widgets/title']='text "next2"';assert.equal(w.build(files,target).outputs.out,'next2');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-003", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v3"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v3');files['widgets/title']='text "next3"';assert.equal(w.build(files,target).outputs.out,'next3');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-004", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v4"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v4');files['widgets/title']='text "next4"';assert.equal(w.build(files,target).outputs.out,'next4');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-005", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v5"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v5');files['widgets/title']='text "next5"';assert.equal(w.build(files,target).outputs.out,'next5');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-006", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v6"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v6');files['widgets/title']='text "next6"';assert.equal(w.build(files,target).outputs.out,'next6');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-007", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v7"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v7');files['widgets/title']='text "next7"';assert.equal(w.build(files,target).outputs.out,'next7');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-008", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v8"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v8');files['widgets/title']='text "next8"';assert.equal(w.build(files,target).outputs.out,'next8');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-009", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v9"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v9');files['widgets/title']='text "next9"';assert.equal(w.build(files,target).outputs.out,'next9');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-010", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v10"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v10');files['widgets/title']='text "next10"';assert.equal(w.build(files,target).outputs.out,'next10');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-011", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v11"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v11');files['widgets/title']='text "next11"';assert.equal(w.build(files,target).outputs.out,'next11');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-012", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v12"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v12');files['widgets/title']='text "next12"';assert.equal(w.build(files,target).outputs.out,'next12');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-013", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v13"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v13');files['widgets/title']='text "next13"';assert.equal(w.build(files,target).outputs.out,'next13');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-014", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v14"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v14');files['widgets/title']='text "next14"';assert.equal(w.build(files,target).outputs.out,'next14');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-015", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v15"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v15');files['widgets/title']='text "next15"';assert.equal(w.build(files,target).outputs.out,'next15');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-016", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v16"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v16');files['widgets/title']='text "next16"';assert.equal(w.build(files,target).outputs.out,'next16');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-017", async () => {
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "v17"','lib/ui/title':'text "bad"'};const target=[{name:'a',entry:'app',output:'out'}];assert.equal(w.build(files,target).outputs.out,'v17');files['widgets/title']='text "next17"';assert.equal(w.build(files,target).outputs.out,'next17');assert.deepEqual(w.build(files,[]).outputs,{});
});
test("kiln-interaction-018", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old0"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new0"';const report=w.build(files,target);assert.equal(report.outputs.out,'new0');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-019", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old1"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new1"';const report=w.build(files,target);assert.equal(report.outputs.out,'new1');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-020", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old2"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new2"';const report=w.build(files,target);assert.equal(report.outputs.out,'new2');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-021", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old3"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new3"';const report=w.build(files,target);assert.equal(report.outputs.out,'new3');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-022", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old4"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new4"';const report=w.build(files,target);assert.equal(report.outputs.out,'new4');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-023", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old5"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new5"';const report=w.build(files,target);assert.equal(report.outputs.out,'new5');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-024", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old6"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new6"';const report=w.build(files,target);assert.equal(report.outputs.out,'new6');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-025", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old7"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new7"';const report=w.build(files,target);assert.equal(report.outputs.out,'new7');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-026", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old8"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new8"';const report=w.build(files,target);assert.equal(report.outputs.out,'new8');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-027", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old9"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new9"';const report=w.build(files,target);assert.equal(report.outputs.out,'new9');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-028", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old10"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new10"';const report=w.build(files,target);assert.equal(report.outputs.out,'new10');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-029", async () => {
const files={root:'use "mid"\ntake 0',mid:'use "leaf"\ntake 0',leaf:'text "old11"'};const w=new Workspace();const target=[{name:'a',entry:'root',output:'out'}];w.build(files,target);files.leaf='text "new11"';const report=w.build(files,target);assert.equal(report.outputs.out,'new11');assert.ok(report.trace.every(r=>r.kind==='built'));assert.ok(w.build(files,target).trace.every(r=>r.kind==='cached'));
});
test("kiln-interaction-030", async () => {
const a=['x0','é','🐍'],b=['x0é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-031", async () => {
const a=['x1','é','🐍'],b=['x1é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-032", async () => {
const a=['x2','é','🐍'],b=['x2é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-033", async () => {
const a=['x3','é','🐍'],b=['x3é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-034", async () => {
const a=['x4','é','🐍'],b=['x4é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-035", async () => {
const a=['x5','é','🐍'],b=['x5é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-036", async () => {
const a=['x6','é','🐍'],b=['x6é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-037", async () => {
const a=['x7','é','🐍'],b=['x7é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-038", async () => {
const a=['x8','é','🐍'],b=['x8é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-039", async () => {
const a=['x9','é','🐍'],b=['x9é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-040", async () => {
const a=['x10','é','🐍'],b=['x10é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-041", async () => {
const a=['x11','é','🐍'],b=['x11é','🐍'];const hash=parts=>{const h=createHash('sha256');for(const p of parts)h.update(String(Buffer.byteLength(p))+':').update(p);return h.digest('hex');};assert.equal(digest(a),hash(a));assert.equal(digest(b),hash(b));assert.notEqual(digest(a),digest(b));
});
test("kiln-interaction-042", async () => {
const w=new Workspace({aliases:{'@x':'lib'}});const files={root:'use "@xyz"\ntake 0','@xyz':'text "ok0"','libyz':'text "wrong"'};const target=[{name:'a',entry:'root',output:'first'},{name:'b',entry:'@xyz',output:'second'}];const a=w.build(files,target);assert.equal(a.outputs.first,'ok0');assert.deepEqual(w.build(files,[target[1]]).outputs,{second:'ok0'});assert.throws(()=>w.build({root:'use "missing"'},target));assert.deepEqual(w.inspect().outputs,{second:'ok0'});
});
test("kiln-interaction-043", async () => {
const w=new Workspace({aliases:{'@x':'lib'}});const files={root:'use "@xyz"\ntake 0','@xyz':'text "ok1"','libyz':'text "wrong"'};const target=[{name:'a',entry:'root',output:'first'},{name:'b',entry:'@xyz',output:'second'}];const a=w.build(files,target);assert.equal(a.outputs.first,'ok1');assert.deepEqual(w.build(files,[target[1]]).outputs,{second:'ok1'});assert.throws(()=>w.build({root:'use "missing"'},target));assert.deepEqual(w.inspect().outputs,{second:'ok1'});
});
test("kiln-interaction-044", async () => {
const w=new Workspace({aliases:{'@x':'lib'}});const files={root:'use "@xyz"\ntake 0','@xyz':'text "ok2"','libyz':'text "wrong"'};const target=[{name:'a',entry:'root',output:'first'},{name:'b',entry:'@xyz',output:'second'}];const a=w.build(files,target);assert.equal(a.outputs.first,'ok2');assert.deepEqual(w.build(files,[target[1]]).outputs,{second:'ok2'});assert.throws(()=>w.build({root:'use "missing"'},target));assert.deepEqual(w.inspect().outputs,{second:'ok2'});
});
test("kiln-interaction-045", async () => {
const w=new Workspace({aliases:{'@x':'lib'}});const files={root:'use "@xyz"\ntake 0','@xyz':'text "ok3"','libyz':'text "wrong"'};const target=[{name:'a',entry:'root',output:'first'},{name:'b',entry:'@xyz',output:'second'}];const a=w.build(files,target);assert.equal(a.outputs.first,'ok3');assert.deepEqual(w.build(files,[target[1]]).outputs,{second:'ok3'});assert.throws(()=>w.build({root:'use "missing"'},target));assert.deepEqual(w.inspect().outputs,{second:'ok3'});
});
test("kiln-interaction-046", async () => {
const w=new Workspace({aliases:{'@x':'lib'}});const files={root:'use "@xyz"\ntake 0','@xyz':'text "ok4"','libyz':'text "wrong"'};const target=[{name:'a',entry:'root',output:'first'},{name:'b',entry:'@xyz',output:'second'}];const a=w.build(files,target);assert.equal(a.outputs.first,'ok4');assert.deepEqual(w.build(files,[target[1]]).outputs,{second:'ok4'});assert.throws(()=>w.build({root:'use "missing"'},target));assert.deepEqual(w.inspect().outputs,{second:'ok4'});
});
test("kiln-interaction-047", async () => {
const w=new Workspace({aliases:{'@x':'lib'}});const files={root:'use "@xyz"\ntake 0','@xyz':'text "ok5"','libyz':'text "wrong"'};const target=[{name:'a',entry:'root',output:'first'},{name:'b',entry:'@xyz',output:'second'}];const a=w.build(files,target);assert.equal(a.outputs.first,'ok5');assert.deepEqual(w.build(files,[target[1]]).outputs,{second:'ok5'});assert.throws(()=>w.build({root:'use "missing"'},target));assert.deepEqual(w.inspect().outputs,{second:'ok5'});
});
test("kiln-interaction-048", async () => {
const w=new Workspace({aliases:{'@x':'lib'}});const files={root:'use "@xyz"\ntake 0','@xyz':'text "ok6"','libyz':'text "wrong"'};const target=[{name:'a',entry:'root',output:'first'},{name:'b',entry:'@xyz',output:'second'}];const a=w.build(files,target);assert.equal(a.outputs.first,'ok6');assert.deepEqual(w.build(files,[target[1]]).outputs,{second:'ok6'});assert.throws(()=>w.build({root:'use "missing"'},target));assert.deepEqual(w.inspect().outputs,{second:'ok6'});
});
test("kiln-interaction-049", async () => {
const w=new Workspace({aliases:{'@x':'lib'}});const files={root:'use "@xyz"\ntake 0','@xyz':'text "ok7"','libyz':'text "wrong"'};const target=[{name:'a',entry:'root',output:'first'},{name:'b',entry:'@xyz',output:'second'}];const a=w.build(files,target);assert.equal(a.outputs.first,'ok7');assert.deepEqual(w.build(files,[target[1]]).outputs,{second:'ok7'});assert.throws(()=>w.build({root:'use "missing"'},target));assert.deepEqual(w.inspect().outputs,{second:'ok7'});
});
