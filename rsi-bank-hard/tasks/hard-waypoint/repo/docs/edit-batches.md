# Pointer batch editing
Apply(document,operations) returns a new JSON tree or (nil,error).
JSON trees contain map[string]any, []any, string, float64, bool or nil.
Inputs are assumed to have these types and no cycles.
Input maps and slices must remain unchanged, even after a failed batch.
Operation values must also remain unchanged.
The output must not share mutable maps or slices with inputs or operation values.
Operations execute in order against the result of previous operations.
A failure aborts the entire batch and returns nil plus non-nil error.
Error messages are not part of the contract.
An empty batch returns an independent deep copy.
## Pointer syntax
The empty pointer refers to the document root.
Every other pointer must begin with slash.
Split into tokens on slash before decoding escapes.
Empty tokens are valid object keys.
Decode ~0 as tilde and ~1 as slash in one left-to-right pass.
Do not decode resulting tildes a second time.
A lone tilde or any other tilde escape is invalid.
Spaces, percent signs, Unicode and backslashes are literal key characters.
There is no percent decoding.
There is no Unicode normalization.
## Object navigation
Each intermediate object key must already exist.
A present key whose value is nil exists.
Only add may create a missing final object key.
Add to an existing key replaces its value.
Replace requires an existing key, including when the new value is nil.
Remove requires an existing key.
Do not create intermediate containers automatically.
Navigating through a scalar is an error.
## Array navigation
An index token is an unsigned decimal integer in canonical form.
Zero is written 0, not 00.
Leading plus and minus signs are invalid.
Whitespace is invalid in an index token.
Overflowing machine int is invalid.
For traversal, remove, replace, test and source pointers, index must be below length.
For a final add destination, index may equal length.
The token dash is permitted only at a final add destination and denotes length.
Dash cannot be an intermediate array index.
Dash remains an ordinary object key.
Array add inserts before the selected element.
Add at length appends.
Remove closes the gap and shortens length.
Replace preserves length.
Nested array edits must update the parent container with the new slice.
An array destination is interpreted against current state at that operation.
## Operations
Operation has fields Op, Path, From and Value.
Op is case-sensitive.
Only add, remove, replace, copy, move, merge and test are supported.
Unused fields are ignored.
add writes a deep copy of Value.
replace writes a deep copy of Value after existence validation.
remove deletes the selected member or element.
Removing root yields a nil document.
Adding root replaces the whole document.
Replacing root replaces the whole document, even if root is nil.
test reads Path and compares against Value recursively.
Test requires exact JSON types; float64(1) does not equal string 1.
Array order matters.
Object map iteration order does not matter.
Missing is different from present nil.
A failed test aborts the batch.
A successful test does not alter the document.
copy reads From before adding its deep copy at Path.
Copy source must exist.
Copy may target a descendant of its source; cloning prevents cycles.
move reads From, removes From, then adds the captured value at Path.
Move destination is evaluated after removal.
Moving an array element forward uses post-removal indexing.
Moving a source to exactly the same decoded token path is a validated no-op.
A same-path move still requires the source to exist.
Moving a node into a proper descendant is invalid.
Ancestor detection compares decoded tokens, not string prefixes.
The root is an ancestor of every non-root path.
A move to root is allowed.
A copy from root is allowed.
An invalid destination after source removal still leaves input unchanged.
## Object merge
merge requires Path to exist and hold an object.
Value must be an object too.
For each patch key with null value, remove the destination key if present.
For each patch key with an object value, recursively merge into the existing object.
If the existing value is absent or is not an object, recursively merge into an empty object.
An empty incoming object preserves an existing object.
An empty incoming object replaces a scalar with an empty object.
Nonobject nonnull patch values replace the destination value by deep copy.
Arrays replace whole arrays rather than concatenate.
Merge works at root or an existing nested object.
A merge into an array or scalar is an error.
Missing Path is an error; missing final patch keys may be created.
Merge never modifies Value or caller-owned input.
The entire batch remains atomic if a later operation fails.
## Integration
Source files may be added, but tests and go.mod are immutable.
Use only the Go standard library.
No concurrency, network, wall clock or randomness is needed.
Run go test ./... .
## Normative pointer tokens
The following table is normative for object keys, not array indices.
| / | valid tokens; decode once |
| /parent/ | valid tokens; decode once |
| /a | valid tokens; decode once |
| /parent/a | valid tokens; decode once |
| /~0 | valid tokens; decode once |
| /parent/~0 | valid tokens; decode once |
| /~1 | valid tokens; decode once |
| /parent/~1 | valid tokens; decode once |
| /~01 | valid tokens; decode once |
| /parent/~01 | valid tokens; decode once |
| /~10 | valid tokens; decode once |
| /parent/~10 | valid tokens; decode once |
| /a~1b | valid tokens; decode once |
| /parent/a~1b | valid tokens; decode once |
| /~0~1 | valid tokens; decode once |
| /parent/~0~1 | valid tokens; decode once |
| /%2F | valid tokens; decode once |
| /parent/%2F | valid tokens; decode once |
| /a b | valid tokens; decode once |
| /parent/a b | valid tokens; decode once |
| /é | valid tokens; decode once |
| /parent/é | valid tokens; decode once |
| /- | valid tokens; decode once |
| /parent/- | valid tokens; decode once |
| /00 | valid tokens; decode once |
| /parent/00 | valid tokens; decode once |
| /0 | valid tokens; decode once |
| /parent/0 | valid tokens; decode once |
| /1 | valid tokens; decode once |
| /parent/1 | valid tokens; decode once |
| /_ | valid tokens; decode once |
| /parent/_ | valid tokens; decode once |
| /a~0b | valid tokens; decode once |
| /parent/a~0b | valid tokens; decode once |
| /~1~0 | valid tokens; decode once |
| /parent/~1~0 | valid tokens; decode once |
| /~~ | invalid escape |
| /parent/~~ | invalid escape |
| /~2 | invalid escape |
| /parent/~2 | invalid escape |
| /~ | invalid escape |
| /parent/~ | invalid escape |
## Batch outcome rules
Every successful operation updates only its selected destination.
Every later operation sees those updates.
No operation may observe the caller mutating the returned result before return.
Mutable sharing within the input is not promised to remain shared in output.
An output map may have any iteration order.
Slices must not retain removed values in the observable length.
The returned root can have any JSON type, including nil.
The original root can have any JSON type, including nil.
Root replacement can enable later non-root operations.
Root removal can be followed by another root add.
An invalid operation name fails even if Path is root.
Invalid pointer syntax fails before any operation-specific write.
The specification is authoritative over the original basic object implementation.
