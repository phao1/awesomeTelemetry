The archive browser handles parent segments as ordinary names. Repair evaluate(path) to normalize a slash-separated virtual path beneath its root. Ignore empty and current-directory segments, resolve parent segments without escaping the root, and always return an absolute path without a trailing separator except at root. Other segment characters are literal.

Keep the existing public entry point. Use only the standard library.
