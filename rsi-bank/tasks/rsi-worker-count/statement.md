The batch scheduler underallocates workers when work does not divide evenly. Repair Evaluate(items, capacity) to return the smallest worker count that can process all items without exceeding per-worker capacity. Items are nonnegative, capacity is positive, and both fit in int. Avoid overflowing intermediate arithmetic.

Keep the existing public entry point. Use only the standard library.
