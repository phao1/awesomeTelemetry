The replicated document view resurrects deleted documents after delayed deliveries. Repair evaluate(events) and its revision helper. Events contain key, revision, deleted, and value. Keep the highest revision for each key; at equal revisions deletion wins, otherwise keep the earlier delivery. Tombstones must participate in revision comparison. Return a plain object containing only live values. Inputs must remain unchanged.

Keep the existing public entry point. Use only the standard library.
