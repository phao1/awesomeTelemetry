The text compressor drops the last run and counts bytes instead of characters. Repair Evaluate(text) to return consecutive runs as Run structs containing a rune and its count, in encounter order. Empty input yields an allocated empty slice. Adjacent equal runes belong to the same run.

Keep the existing public entry point. Use only the standard library.
