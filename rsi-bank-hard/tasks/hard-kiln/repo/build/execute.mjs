import {identity} from '../cache/key.mjs';
import {digest} from '../digest.mjs';
import {evaluate} from '../transforms/text.mjs';
export function execute(graph,order,cache,options) {
  const built=new Map();const trace=[];
  for(const path of order) {
    const node=graph.load(path);
    const dependencies=node.dependencies.map(dep=>built.get(dep));
    const key=identity(node,dependencies,options);
    let result=cache.get(key);
    if(result===null) {
      const text=evaluate(node.syntax.operations,dependencies);
      result={text,hash:digest([options.version,text,options.separator])};
      cache.put(key,result);trace.push({path,kind:'built'});
    } else trace.push({path,kind:'cached'});
    built.set(path,result);
  }
  return {built,trace};
}
