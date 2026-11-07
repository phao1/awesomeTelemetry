import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from './workspace.mjs';
import {parse} from './syntax/module.mjs';
import {Graph} from './graph/workspace.mjs';
import {normalize,relative,extension} from './paths.mjs';
import {Entries} from './cache/entries.mjs';
test('workflow 1',()=>{
  const w=new Workspace({version:'v0'});
  const files={
    'shared': 'text "base0"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base0  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base0  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 2',()=>{
  const w=new Workspace({version:'v1'});
  const files={
    'shared': 'text "base1"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base1  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base1  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 3',()=>{
  const w=new Workspace({version:'v2'});
  const files={
    'shared': 'text "base2"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base2  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base2  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 4',()=>{
  const w=new Workspace({version:'v3'});
  const files={
    'shared': 'text "base3"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base3  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base3  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 5',()=>{
  const w=new Workspace({version:'v4'});
  const files={
    'shared': 'text "base4"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base4  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base4  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 6',()=>{
  const w=new Workspace({version:'v5'});
  const files={
    'shared': 'text "base5"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base5  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base5  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 7',()=>{
  const w=new Workspace({version:'v6'});
  const files={
    'shared': 'text "base6"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base6  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base6  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 8',()=>{
  const w=new Workspace({version:'v7'});
  const files={
    'shared': 'text "base7"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base7  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base7  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 9',()=>{
  const w=new Workspace({version:'v8'});
  const files={
    'shared': 'text "base8"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base8  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base8  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 10',()=>{
  const w=new Workspace({version:'v9'});
  const files={
    'shared': 'text "base9"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base9  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base9  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 11',()=>{
  const w=new Workspace({version:'v10'});
  const files={
    'shared': 'text "base10"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base10  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base10  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 12',()=>{
  const w=new Workspace({version:'v11'});
  const files={
    'shared': 'text "base11"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base11  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base11  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 13',()=>{
  const w=new Workspace({version:'v12'});
  const files={
    'shared': 'text "base12"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base12  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base12  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 14',()=>{
  const w=new Workspace({version:'v13'});
  const files={
    'shared': 'text "base13"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base13  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base13  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 15',()=>{
  const w=new Workspace({version:'v14'});
  const files={
    'shared': 'text "base14"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base14  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base14  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 16',()=>{
  const w=new Workspace({version:'v15'});
  const files={
    'shared': 'text "base15"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base15  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base15  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 17',()=>{
  const w=new Workspace({version:'v16'});
  const files={
    'shared': 'text "base16"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base16  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base16  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 18',()=>{
  const w=new Workspace({version:'v17'});
  const files={
    'shared': 'text "base17"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base17  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base17  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 19',()=>{
  const w=new Workspace({version:'v18'});
  const files={
    'shared': 'text "base18"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base18  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base18  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 20',()=>{
  const w=new Workspace({version:'v19'});
  const files={
    'shared': 'text "base19"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base19  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base19  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 21',()=>{
  const w=new Workspace({version:'v20'});
  const files={
    'shared': 'text "base20"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base20  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base20  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 22',()=>{
  const w=new Workspace({version:'v21'});
  const files={
    'shared': 'text "base21"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base21  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base21  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 23',()=>{
  const w=new Workspace({version:'v22'});
  const files={
    'shared': 'text "base22"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base22  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base22  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 24',()=>{
  const w=new Workspace({version:'v23'});
  const files={
    'shared': 'text "base23"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base23  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base23  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 25',()=>{
  const w=new Workspace({version:'v24'});
  const files={
    'shared': 'text "base24"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base24  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base24  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 26',()=>{
  const w=new Workspace({version:'v25'});
  const files={
    'shared': 'text "base25"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base25  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base25  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 27',()=>{
  const w=new Workspace({version:'v26'});
  const files={
    'shared': 'text "base26"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base26  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base26  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 28',()=>{
  const w=new Workspace({version:'v27'});
  const files={
    'shared': 'text "base27"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base27  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base27  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 29',()=>{
  const w=new Workspace({version:'v28'});
  const files={
    'shared': 'text "base28"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base28  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base28  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 30',()=>{
  const w=new Workspace({version:'v29'});
  const files={
    'shared': 'text "base29"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base29  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base29  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 31',()=>{
  const w=new Workspace({version:'v30'});
  const files={
    'shared': 'text "base30"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base30  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base30  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 32',()=>{
  const w=new Workspace({version:'v31'});
  const files={
    'shared': 'text "base31"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base31  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base31  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 33',()=>{
  const w=new Workspace({version:'v32'});
  const files={
    'shared': 'text "base32"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base32  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base32  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 34',()=>{
  const w=new Workspace({version:'v33'});
  const files={
    'shared': 'text "base33"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base33  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base33  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 35',()=>{
  const w=new Workspace({version:'v34'});
  const files={
    'shared': 'text "base34"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base34  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base34  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 36',()=>{
  const w=new Workspace({version:'v35'});
  const files={
    'shared': 'text "base35"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base35  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base35  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 37',()=>{
  const w=new Workspace({version:'v36'});
  const files={
    'shared': 'text "base36"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base36  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base36  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 38',()=>{
  const w=new Workspace({version:'v37'});
  const files={
    'shared': 'text "base37"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base37  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base37  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 39',()=>{
  const w=new Workspace({version:'v38'});
  const files={
    'shared': 'text "base38"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base38  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base38  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 40',()=>{
  const w=new Workspace({version:'v39'});
  const files={
    'shared': 'text "base39"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base39  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base39  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 41',()=>{
  const w=new Workspace({version:'v40'});
  const files={
    'shared': 'text "base40"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base40  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base40  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 42',()=>{
  const w=new Workspace({version:'v41'});
  const files={
    'shared': 'text "base41"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base41  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base41  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 43',()=>{
  const w=new Workspace({version:'v42'});
  const files={
    'shared': 'text "base42"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base42  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base42  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 44',()=>{
  const w=new Workspace({version:'v43'});
  const files={
    'shared': 'text "base43"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base43  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base43  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 45',()=>{
  const w=new Workspace({version:'v44'});
  const files={
    'shared': 'text "base44"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base44  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base44  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 46',()=>{
  const w=new Workspace({version:'v45'});
  const files={
    'shared': 'text "base45"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base45  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base45  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 47',()=>{
  const w=new Workspace({version:'v46'});
  const files={
    'shared': 'text "base46"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base46  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base46  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
test('workflow 48',()=>{
  const w=new Workspace({version:'v47'});
  const files={
    'shared': 'text "base47"',
    'pages/a': 'use "../shared"\ntake 0\ntext " tail"\njoin " "',
    'pages/b': 'text "independent"\nupper',
  };
  const targets=[
    {name:'a',entry:'pages/a',output:'out/a'},
    {name:'b',entry:'pages/b',output:'out/b'},
  ];
  const first=w.build(files,targets);
  assert.equal(first.outputs['out/a'],'base47  tail');
  assert.equal(first.outputs['out/b'],'INDEPENDENT');
  assert.equal(first.graph.length,3);
  assert.equal(first.manifest.length,2);
  const second=w.build(files,targets);
  assert.ok(second.trace.every(row=>row.kind==='cached'));
  first.outputs['out/a']='caller mutation';
  assert.equal(w.inspect().outputs['out/a'],'base47  tail');
  const g=new Graph(files,{});
  assert.deepEqual(g.affected(['pages/a','pages/b'],['shared']),['shared','pages/a']);
  assert.equal(normalize('pages/../shared'),'shared');
  assert.equal(relative('pages','shared'),'../shared');
  assert.equal(extension('pages/a.txt'),'.txt');
  assert.equal(parse('text "x"\nreverse').operations.length,2);
  const cache=new Entries();
  cache.put('identity',{text:'value',hash:'digest'});
  const row=cache.get('identity');row.text='modified';
  assert.equal(cache.get('identity').text,'value');
  const restored=new Entries();restored.restore(cache.snapshot());
  assert.deepEqual(restored.snapshot(),cache.snapshot());
});
