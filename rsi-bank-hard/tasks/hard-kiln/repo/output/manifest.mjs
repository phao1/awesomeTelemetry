import {normalize} from '../paths.mjs';
export function targets(input) {
  const found=new Set();const names=new Set();const out=[];
  for(const item of input) {
    if(typeof item.name!=='string'||!item.name||names.has(item.name))throw new Error('target name');
    const entry=normalize(item.entry),output=normalize(item.output);
    if(!entry||!output||found.has(output))throw new Error('output collision');
    found.add(output);names.add(item.name);out.push({name:item.name,entry,output});
  }
  return out;
}
export function describe(items,built) {
  return items.map(item=>({...item,hash:built.get(item.entry).hash,bytes:Buffer.byteLength(built.get(item.entry).text)}));
}
