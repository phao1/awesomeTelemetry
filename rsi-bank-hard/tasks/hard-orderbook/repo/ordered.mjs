import { Cells } from './cells.mjs';
export class Ordered {
  constructor(compare,cells=new Cells()) {
    this.compare=compare;
    this.cells=cells;
    this.ids=new Set();
    this.serial=0;
  }
  put(id,key,weight) {
    const old=this.ids.has(id)?this.cells.read(id):null;
    this.ids.add(id);
    this.cells.write(id,{id,key,weight,serial:old?.serial??this.serial++});
  }
  remove(id) {
    if(!this.ids.delete(id))return false;
    this.cells.drop(id);
    return true;
  }
  sorted() {
    return [...this.ids].map(id=>this.cells.read(id))
      .sort((a,b)=>this.compare(a.key,b.key)||a.serial-b.serial);
  }
  rank(key,inclusive=false) {
    return this.sorted().filter(r=>this.compare(r.key,key)<0||(inclusive&&this.compare(r.key,key)===0)).length;
  }
  select(index) { return this.sorted()[index]?.id??null; }
  prefix(count) { return this.sorted().slice(0,Math.max(0,count)).reduce((s,r)=>s+r.weight,0); }
  get size() { return this.ids.size; }
}
