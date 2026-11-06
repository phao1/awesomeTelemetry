Recovery replays duplicate journal records and can move a record backwards in revision. Repair Evaluate(events) and the revision policy. Each Event has ID, Key, Revision, Value and Deleted. Process each event ID only once, even when a later duplicate changes its contents. For a key, retain only a strictly newer revision; equal revisions keep the earlier event. Deletions retain revision history but are omitted from the returned live value map. Inputs remain unchanged.

Keep the existing public entry point. Use only the standard library.
