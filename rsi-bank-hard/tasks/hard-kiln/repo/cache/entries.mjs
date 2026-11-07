export class Entries {
  constructor() {this.rows=new Map();this.hits=0;this.misses=0;}
  get(key) {
    const row=this.rows.get(key);
    if(row===undefined){this.misses++;return null;}
    this.hits++;return structuredClone(row);
  }
  put(key,value){this.rows.set(key,structuredClone(value));}
  clear(){this.rows.clear();this.hits=0;this.misses=0;}
  snapshot(){return [...this.rows].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,...structuredClone(value)}));}
  restore(rows){
    const next=new Map();for(const row of rows){const {key,...value}=row;if(next.has(key))throw new Error('duplicate cache key');next.set(key,structuredClone(value));}
    this.rows=next;
  }
}
