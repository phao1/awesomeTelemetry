The request limiter retains stale requests and rejects valid requests at the window edge. Repair Evaluate(times, width, limit) to return an admission boolean for every monotonic timestamp. Count only previously admitted requests strictly newer than now minus width. Admit when that count is below limit; rejected requests consume no capacity. Clock arithmetic fits in int. Width is positive and limit is nonnegative.

Keep the existing public entry point. Use only the standard library.
