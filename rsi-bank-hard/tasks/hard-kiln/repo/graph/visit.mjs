export function topological(roots,dependencies) {
  const state=new Map(),order=[],stack=[];
  function visit(node) {
    if(state.get(node)===2)return;
    if(state.get(node)===1)throw new Error('cycle: '+[...stack,node].join(' -> '));
    state.set(node,1);stack.push(node);
    for(const dep of dependencies(node))visit(dep);
    stack.pop();state.set(node,2);order.push(node);
  }
  for(const root of roots)visit(root);
  return order;
}
export function reverseEdges(nodes,dependencies) {
  const reverse=new Map(nodes.map(node=>[node,new Set()]));
  for(const node of nodes)for(const dep of dependencies(node)) {
    if(!reverse.has(dep))reverse.set(dep,new Set());
    reverse.get(dep).add(node);
  }
  return reverse;
}
export function closure(roots,edges) {
  const found=new Set(),queue=[...roots];
  for(let i=0;i<queue.length;i++) {
    const node=queue[i];if(found.has(node))continue;
    found.add(node);for(const next of edges.get(node)??[])queue.push(next);
  }
  return found;
}
