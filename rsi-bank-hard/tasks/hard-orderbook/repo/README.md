# Order statistics
Ordered(compare,cells=new Cells()) indexes arbitrary opaque keys. Only compare(a,b) may inspect key ordering; its sign is conventional. Keys are immutable and compare is total and deterministic.
put(id,key,weight) inserts or replaces a string ID. Weight is a finite integer, including negatives. Replacement preserves original insertion order among equal keys. Removal followed by insertion assigns a new insertion order.
remove(id) returns whether an ID existed. size counts live IDs.
rank(key,inclusive=false) counts keys strictly less, or less-or-equal when inclusive. Stable tie order never changes rank boundaries.
select(index) returns ID or null for a noninteger, negative or out-of-range index.
prefix(count) sums weights of the first count rows, clamping integer count to [0,size]. Empty sums are zero.
Rows are ordered by comparator, then original insertion order. Callers do not mutate keys. Every operation must take O(log(n+2)) time and O(log(n+2)) comparator calls; prefix/select must use cached subtree metadata, not scan rows. Storage is O(n).
The injected comparator counts every invocation. Acceptance bounds each update/query to 96*ceil(log2(n+2)) comparator calls, and construction to 96*n*ceil(log2(n+2)). Implementations must not inspect keys, use hidden primitive key encodings, defer linear work to queries, or precompute all query results. Run node --test ordered.test.mjs.

Cells is an injected flat slot store with read(handle), write(handle,value), drop(handle). Each call counts one access. read/write copy the flat record; opaque key identity is preserved. The provided Cells is a development default, while acceptance injects an independent implementation. Handles are implementation-private strings or numbers.
All persistent row data, links, subtree aggregates and ordering structures must live in cells. Outside cells, retain only root/allocator/serial counters and an ID-to-handle map (or an ID set in the original flat implementation). Transient O(log n) path records are allowed. Do not retain an unmetered array, cache of rows/weights/aggregates, or inspect a cell store's implementation.
Each put/remove/rank/select/prefix must use at most 128*ceil(log2(n+2)) cell accesses, where n is the larger size before/after the operation. Construction uses zero accesses; construction by n puts uses at most 128*n*ceil(log2(n+2)). Missing removal uses zero accesses. The comparator bound applies separately. Linear scans and array shifts are charged through their slot reads/writes, including prefix aggregation.

The injected store starts empty and is exclusive to one index. A slot is a flat record with at most 16 fields: values are primitives, null, or input opaque-key references. Arrays and other nested containers are not slot values. This bound makes one slot access constant work and prevents hiding an entire linear index in one cell. Callers do not modify the store during index operations.
