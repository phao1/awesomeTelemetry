The export deduplicator keeps whichever record arrived last, ignoring record revisions. Repair evaluate(records) to retain the highest revision for each id, keep the earlier record on a revision tie, and return records in first-seen id order. Records have id, revision, and value. Leave inputs untouched.

Keep the existing public entry point. Use only the standard library.
