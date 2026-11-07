import {parse} from '../syntax/module.mjs';
import {normalize} from '../paths.mjs';
import {resolveImport} from '../resolve/imports.mjs';
import {topological,reverseEdges,closure} from './visit.mjs';
export class Graph {
  constructor(files,aliases) {this.files=files;this.aliases=aliases;this.nodes=new Map();}
  load(path) {
    path=normalize(path);
    if(this.nodes.has(path))return this.nodes.get(path);
    if(!Object.hasOwn(this.files,path))throw new Error('missing module '+path);
    const syntax=parse(this.files[path]);
    const dependencies=syntax.imports.map(request=>resolveImport(path,request,this.aliases));
    const node={path,source:this.files[path],syntax,dependencies};this.nodes.set(path,node);return node;
  }
  order(roots) {return topological(roots.map(normalize),path=>this.load(path).dependencies);}
  affected(roots,changed) {
    const order=this.order(roots);
    const reverse=reverseEdges(order,path=>this.load(path).dependencies);
    return order.filter(path=>closure(changed,reverse).has(path));
  }
  describe(roots) {
    return this.order(roots).map(path=>({path,dependencies:[...this.load(path).dependencies]}));
  }
}
