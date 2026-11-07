export class Clock {
  constructor() { this.now = 0; this.next = 0; this.jobs = []; }
  defer(fn) { const id = ++this.next; this.jobs.push({ id, at: this.now, fn }); return id; }
  after(delay, fn) { const id = ++this.next; this.jobs.push({ id, at: this.now + delay, fn }); return id; }
  cancel(id) { this.jobs = this.jobs.filter(job => job.id !== id); }
  ready() { return this.jobs.filter(job => job.at <= this.now).map(job => job.id); }
  step(id = this.ready()[0]) {
    const index = this.jobs.findIndex(job => job.id === id && job.at <= this.now);
    if (index < 0) throw new Error('not ready');
    const [job] = this.jobs.splice(index, 1); job.fn();
  }
  advance(delta) { if (delta < 0) throw new Error('clock reversal'); this.now += delta; }
  flush() { let n = 0; while (this.ready().length) { if (++n > 10000) throw new Error('livelock'); this.step(); } }
}
