export class History {
  constructor(initial = {}) {
    this.epoch = 0;
    this.rows = new Map();
    for (const [key, value] of Object.entries(initial)) {
      this.rows.set(key, [{ epoch: 0, value: structuredClone(value), live: true }]);
    }
  }
  at(key, epoch) {
    const versions = this.rows.get(key) ?? [];
    for (let i = versions.length - 1; i >= 0; i--) {
      if (versions[i].epoch <= epoch) return versions[i];
    }
    return { epoch: -1, value: null, live: false };
  }
  keys(epoch) {
    return [...this.rows.keys()].filter(key => this.at(key, epoch).live).sort();
  }
}
