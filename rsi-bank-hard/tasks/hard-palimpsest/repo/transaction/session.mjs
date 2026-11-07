import { capture, restore } from './frames.mjs';
export class Transaction {
  constructor(history) {
    this.history = history;
    this.snapshot = history.epoch;
    this.writes = new Map();
    this.frames = [];
    this.reads = new Set();
    this.ranges = [];
    this.closed = false;
  }
  get(key) { const row = this.writes.get(key) ?? this.history.at(key, this.snapshot); return row.live ? structuredClone(row.value) : null; }
  put(key, value) { this.writes.set(key, { live: true, value: structuredClone(value) }); }
  delete(key) { this.writes.set(key, { live: false, value: null }); }
  scan(from = null, to = null) { return this.history.keys(this.snapshot).filter(k => (from === null || k >= from) && (to === null || k < to)).map(k => [k, this.get(k)]); }
  savepoint(name) { this.frames.push({ name, ...capture(this) }); }
  rollback(name) { restore(this, this.frames.find(f => f.name === name)); }
  release(name) { this.frames = this.frames.filter(f => f.name !== name); }
  commit() { for (const [k,v] of this.writes) { this.history.rows.set(k, [{ ...v, epoch: ++this.history.epoch }]); } this.closed = true; return { ok: true, epoch: this.history.epoch }; }
  abort() { this.closed = true; }
}
