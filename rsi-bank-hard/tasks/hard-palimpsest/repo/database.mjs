import { History } from './store/history.mjs';
import { Transaction } from './transaction/session.mjs';
export class Database {
  constructor(initial = {}) { this.history = new History(initial); }
  begin() { return new Transaction(this.history); }
  get epoch() { return this.history.epoch; }
}
