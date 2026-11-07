export function pump(pool) {
  while (pool.waiting.length && pool.free >= pool.waiting[0].weight) {
    const item = pool.waiting.shift();
    pool.free -= item.weight;
    item.state = 'held';
    pool.clock.defer(() => item.resolve(pool.receipt(item)));
  }
}
