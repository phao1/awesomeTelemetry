# Scoped record stream v2
## API
Reader() creates an independent incremental parser.
feed(data,final=False) accepts bytes only.
The returned list contains newly published row dictionaries.
An empty feed is legal.
A final feed consumes remaining input and closes the parser.
Feeding after close raises ValueError.
Any syntax, UTF-8 or semantic error raises ValueError.
After an error, every later feed raises ValueError.
A failing feed returns no output, even for earlier rows in that same feed.
Previously returned rows are not retracted.
Unpublished buffered rows become inaccessible after failure.
No diagnostics text is part of the public contract.
No partial parsing work is externally observable.
## Encoding
Decode strict UTF-8 incrementally.
Chunks may end in the middle of any UTF-8 scalar.
Incomplete encoding is legal until final=True.
Incomplete encoding at final is an error.
Invalid encodings are errors immediately when detectable.
No Unicode normalization is performed.
UTF-8 BOM is ordinary content and is not stripped.
## Physical delimiters
Outside quotes, LF ends a logical row.
Outside quotes, CR ends a logical row.
A CR followed immediately by LF is one delimiter.
CR and LF may arrive in separate feed calls.
Inside quotes, CR and LF are ordinary content preserved exactly.
An escaped n produces a LF inside a cell and never ends a row.
An escaped r produces a CR inside a cell and never ends a row.
Final input need not end in a row delimiter.
Blank physical rows are ignored.
A row containing only spaces is not blank.
Whitespace is never implicitly stripped.
## Cells
An unescaped pipe outside quotes ends a cell.
Cells may be empty, including trailing cells.
A quote may occur only as the first character of a cell.
A quote at cell start opens a quoted cell.
A quote inside an unquoted cell is an error.
The closing quote must be followed by pipe, row delimiter or EOF.
No whitespace is permitted after a closing quote.
The empty quoted cell is the empty string.
Quoted cells preserve all enclosed whitespace.
The single unquoted tilde denotes null (Python None).
Quoted tilde is the literal string tilde.
Empty unquoted cells are empty strings, not null.
Inside and outside quotes, backslash starts an escape.
Allowed escapes are n, r, t, pipe, backslash and quote.
Escaped pipe is literal pipe.
Escaped quote does not open or close quoting.
Escaped backslash is one literal backslash.
Unknown escapes are errors.
Dangling escapes at final are errors.
Unclosed quotes at final are errors.
No doubling-quote convention exists.
## Comments
Hash as the very first character of a row starts a comment.
Comment text is ignored through the next CR or LF.
Quotes and escapes have no meaning in comments.
EOF terminates a comment without error.
Hash after whitespace is ordinary cell content.
Hash inside any later cell is ordinary content.
Hash inside quotes is ordinary content.
## Commands
The first cell is a case-sensitive command name.
No alternate capitalization is accepted.
A null command is invalid.
Unknown commands are errors.
Commands are applied only after a complete logical row.
A command spanning chunks has no effect before its delimiter or final EOF.
## Identifiers
Identifiers are nonempty ASCII strings.
Allowed characters are letters, digits and underscore.
The first character must not be a digit.
An underscore is a legal first character.
Non-ASCII letters are not identifiers.
Identifier validation applies to field names and begin frame names.
Quoted identifiers undergo the same validation after decoding.
## Defaults
set|name|value requires exactly three cells.
It assigns a default field in the current scope.
Values may be null or empty strings.
unset|name requires exactly two cells.
It removes a default field from the current scope.
Unsetting a missing default is a successful no-op.
Defaults begin empty.
Defaults affect only later row commands.
## Rows
row followed by zero or more name/value pairs publishes a record.
row alone publishes the current defaults, even if empty.
The total number of cells must be odd.
Each explicit field overrides the same-named default.
A null explicit value overrides instead of deleting the field.
Duplicate explicit field names are errors.
Duplicate checking occurs after quote and escape decoding.
The output record is independent from defaults.
Records in returned lists are independent objects.
Caller mutation of a returned record cannot change later output.
Key iteration order is not part of acceptance.
## Frames
begin|name requires exactly two cells.
It snapshots current defaults and opens a new nested frame.
New rows are buffered inside the innermost frame.
Frame names may repeat at different depths.
There is no maximum nesting depth imposed by the format.
commit|name requires exactly two cells.
It must match the innermost open frame by exact string equality.
It closes that frame and publishes its buffered records to its parent.
With no parent, those records appear in the current feed result.
Commit restores defaults to their state before the matching begin.
Committed rows retain the defaults captured when each row was parsed.
abort|name requires exactly two cells.
It must match the innermost open frame.
It discards the innermost frame and all rows buffered within it.
It restores defaults to their state before begin.
An inner commit does not escape an outer abort.
An inner abort does not discard already buffered outer rows.
Closing a nonexistent frame is an error.
Closing an outer frame while an inner frame remains is an error.
Final input with any open frame is an error.
## Delivery boundaries
Rows outside frames publish as soon as their logical row ends.
Rows inside frames publish only when the outermost frame commits.
One feed may publish multiple rows in source order.
Feeds containing only frame operations can publish buffered rows.
Chunking must never change final output or error status.
An empty final input is valid when no frame or partial cell is open.
An empty final feed still validates UTF-8 and frame completion.
## Constraints
Use the Python standard library only.
The parser must be incremental; do not retain the entire consumed input.
Retaining a partial logical row and unpublished frame rows is permitted.
Change source files only.
Run python3 -m unittest table.test_stream.
## Normative cell examples
The table describes a cell payload after a row command and field name.
| plain | plain |
| ~ | null |
| "~" | tilde string |
| "" | empty string |
|  | empty string |
| "a|b" | a pipe b |
| a\|b | a pipe b |
| "a\nb" | a LF b |
| "a\rb" | a CR b |
| a\tb | a TAB b |
| "two words" | two words |
| two words | two words |
|  leading | leading space retained |
| trailing  | trailing space retained |
| #suffix | hash ordinary after field |
| "#" | hash string |
| é | Unicode e acute |
| "🐍" | snake scalar |
| a\\b | a backslash b |
| a\"b | a quote b |
| "a"x | error |
| a"b | error |
| a\q | error |
| "a | error |
| \ | error |
| "a"  | error |
| "a"" | error |
| "a"| | cell a then empty cell |
