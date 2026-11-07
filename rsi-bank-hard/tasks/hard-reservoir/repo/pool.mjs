import { pump } from './reservations/pump.mjs';
export class Pool {
  constructor(capacity, clock) { this.capacity=capacity;this.free=capacity;this.clock=clock;this.waiting=[];this.items=new Set();this.closed=false; }
  acquire(weight=1, timeout=null) {
    if (!Number.isInteger(weight) || weight < 1 || weight > this.capacity) throw new RangeError('weight');
    if (timeout !== null && (!Number.isInteger(timeout) || timeout < 0)) throw new RangeError('timeout');
    let resolve, reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    const item={weight,resolve,reject,state:'waiting',timer:null};this.items.add(item);
    if (this.closed) { item.state='done';reject(new Error('closed')); }
    else { this.waiting.push(item);if(timeout!==null)item.timer=this.clock.after(timeout,()=>this.cancel(item,'timeout'));pump(this); }
    return {promise,cancel:()=>this.cancel(item,'cancelled')};
  }
  cancel(item,reason) { if(item.state==='done')return false;item.state='done';item.reject(new Error(reason));pump(this);return true; }
  receipt(item) { return {weight:item.weight,release:()=>{this.free+=item.weight;item.state='done';pump(this);return true;}}; }
  close() { this.closed=true;for(const item of this.items)if(item.state==='waiting')this.cancel(item,'closed'); }
  stats() { return {free:this.free,waiting:this.waiting.filter(x=>x.state==='waiting').length,held:[...this.items].filter(x=>x.state==='held').reduce((n,x)=>n+x.weight,0)}; }
}
