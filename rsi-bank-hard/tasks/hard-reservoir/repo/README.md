# Weighted reservations
Pool(capacity,clock) uses the supplied Clock; no real timers or randomness are allowed.
acquire(weight=1,timeout=null) returns {promise,cancel}. The promise resolves to a frozen {weight,release} receipt, or rejects Error with message cancelled, timeout, or closed.
Weights and capacity are positive integers; weight cannot exceed capacity. Timeout is null or a nonnegative integer. Invalid arguments throw RangeError synchronously, including on closed pools.
Reservations obey strict FIFO; a large head cannot be bypassed. A request reserves capacity synchronously, then becomes owned only when a deferred clock job publishes its receipt.
Cancellation returns true only while waiting or reserved. It rejects exactly once and returns any reserved capacity. Cancellation of a published owner returns false.
Timeout starts at request creation and competes with delivery in scheduler order, including at zero delay. Whichever job executes first wins. Published ownership has no expiry.
release returns true exactly once and restores capacity; later calls return false. Each receipt releases only its own reservation.
close is idempotent: rejects all unpublished requests with closed, returns reserved capacity, preserves published owners, and prevents future grants. Acquiring after close returns a rejected promise.
stats returns {free,waiting,held}; held is total weight reserved or published, waiting counts only unreserved tickets. free+held equals capacity at every observable point.
The clock may run any ready job next; callbacks may create, cancel or release other requests. No stale job may revive a cancelled request. Run node --test pool.test.mjs.
