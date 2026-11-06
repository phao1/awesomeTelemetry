Pre-epoch readings are placed in the wrong bucket. Repair evaluate(timestamp, width) to return the start of the fixed-width bucket containing the timestamp, using mathematical floor division. Inputs are integers, width is positive, and bucket boundaries belong to the bucket that starts there.

Keep the existing public entry point. Use only the standard library.
