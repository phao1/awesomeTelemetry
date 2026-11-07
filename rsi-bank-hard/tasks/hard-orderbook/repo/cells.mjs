export class Cells {
  #rows = new Map();
  accesses = 0;
  read(handle) {
    this.accesses++;
    if (!this.#rows.has(handle)) throw new Error('missing cell');
    return { ...this.#rows.get(handle) };
  }
  write(handle, value) {
    if (Object.keys(value).length > 16 || Object.values(value).some(Array.isArray)) throw new RangeError('flat slot');
    this.accesses++;
    this.#rows.set(handle, { ...value });
  }
  drop(handle) {
    this.accesses++;
    this.#rows.delete(handle);
  }
}
