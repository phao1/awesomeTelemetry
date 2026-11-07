# Incremental build workspace
Run `node reproduce.mjs` to replay the reported workspace, and `node --test workspace.test.mjs` for supported workflows.
The workspace builds string artifacts from a small pipeline language. Public entry: Workspace from workspace.mjs.
## Build API
new Workspace({version='v1',separator='',aliases={}}) owns reusable content cache and outputs.
build(files,targets) consumes a complete snapshot, not a filesystem delta.
files maps normalized relative paths to source strings.
Targets contain unique name, entry and output. Duplicate output paths are errors.
Each successful build publishes exactly the requested targets, removing outputs absent from the new manifest.
A failed build preserves the previous published outputs and last report.
Cache entries from a failed attempt may be retained because content identities are immutable.
The report contains outputs, manifest, trace and graph. Returned values cannot alias internal state.
inspect returns a fresh copy of the last successful report or null.
## Module resolution
Dot-prefixed imports resolve relative to the importing module's directory.
Other imports are workspace-relative unless an alias matches.
An alias matches its exact key or that key followed by a slash; a mere string prefix does not match.
Among matching aliases choose the longest key, regardless of insertion order.
Normalize dot and parent segments after substitution. Escaping above root is an error.
Dependencies are ordered, and repeated imports remain repeated for take indices.
Cycles and missing modules are errors, including after changing an alias target.
## Pipeline language
Blank lines and trimmed hash comments are ignored.
use followed by a JSON quoted string declares an import.
text followed by a JSON quoted string pushes a literal.
take followed by a nonnegative integer pushes the corresponding imported artifact.
upper, lower, reverse, trim and unique transform each current stack item.
reverse and unique operate on Unicode scalar sequences.
join followed by a JSON quoted string replaces the stack by one joined string.
repeat followed by an integer from zero through one hundred repeats each stack item.
At end, concatenate the stack with an empty separator.
Every take index is validated before evaluation.
## Content identities
All hashes are SHA256 UTF-8 hexadecimal.
A list of strings is framed by, for each string, its UTF-8 BYTE length in decimal, colon, then the exact UTF-8 bytes. Concatenate those frames and hash.
Artifact hash is the framed digest of [version,text,separator].
Module cache identity is the framed digest of [version,normalized path,source,separator,...ordered dependency artifact hashes].
A dependency changing its artifact must rebuild its transitive consumers; unrelated artifacts can remain cached.
Two differently segmented string lists must never alias just because their raw concatenations match.
An unchanged source whose dependency artifact changes is not a cache hit.
Build trace follows dependency-first DFS order and records built or cached.
A shared dependency is visited once per build.
## Graph utilities
Graph.describe returns reachable nodes in dependency-first order, preserving dependency arrays.
Graph.affected follows reverse dependency reachability from changed paths.
The loader parses lazily and errors only for reachable missing or invalid modules.
Unrequested broken modules do not break a build.
## Repository layout
syntax contains the line and module parsers.
transforms contains text evaluation.
graph contains traversal and workspace graph construction.
cache contains reusable immutable content entries.
output contains requested manifest validation and publication.
build contains options and dependency-first execution.
No test or dependency declaration may be changed by a repair.
