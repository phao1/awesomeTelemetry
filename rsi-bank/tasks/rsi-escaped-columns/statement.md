Import rows containing escaped separators are split incorrectly. Repair evaluate(line) to split on unescaped vertical bars. Backslash escapes the next character, including a separator or another backslash; a final unmatched backslash is literal. Retain empty fields and do not trim whitespace.

Keep the existing public entry point. Use only the standard library.
