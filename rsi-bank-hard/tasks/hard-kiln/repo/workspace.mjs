import {Graph} from './graph/workspace.mjs';
import {Entries} from './cache/entries.mjs';
import {targets,describe} from './output/manifest.mjs';
import {publish} from './output/publish.mjs';
import {execute} from './build/execute.mjs';
import {options} from './build/options.mjs';
export class Workspace {
  constructor(config={}){this.options=options(config);this.cache=new Entries();this.outputs=new Map();this.last=null;}
  build(files,requested) {
    const items=targets(requested);
    const graph=new Graph(files,this.options.aliases);
    const order=graph.order(items.map(target=>target.entry));
    const {built,trace}=execute(graph,order,this.cache,this.options);
    const outputs=publish(this.outputs,items,built);
    const report={outputs:Object.fromEntries(outputs),manifest:describe(items,built),trace,graph:graph.describe(items.map(t=>t.entry))};
    this.outputs=outputs;this.last=structuredClone(report);
    return structuredClone(report);
  }
  inspect(){return structuredClone(this.last);}
}
