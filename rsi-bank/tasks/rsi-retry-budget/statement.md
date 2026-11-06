Retries can sleep beyond the configured cap and the first retry waits too long. Repair evaluate(base, attempt, cap, remaining): attempt is a nonnegative retry index, beginning with the first retry. Exponential delay starts at base and doubles per subsequent attempt, bounded by both cap and remaining. All other inputs are finite nonnegative numbers. Large attempts must stay bounded.

Keep the existing public entry point. Use only the standard library.
