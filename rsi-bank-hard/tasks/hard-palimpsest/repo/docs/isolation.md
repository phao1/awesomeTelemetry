# Transaction revision
## Scope
The public entry is Database from database.mjs.
Database(initial={}) owns a version history.
initial is an object with string keys and JSON-compatible values.
All operations are synchronous.
No persistence or wall clock is involved.
The complete revision applies to every transaction, including read-only ones.
## Identity and epochs
Database.epoch initially equals zero.
Each initial value belongs to epoch zero.
Absent keys have version epoch minus one.
A successful commit with at least one staged write advances the epoch once.
All keys in that commit have the same new epoch.
A successful empty commit leaves the epoch unchanged.
A failed commit leaves the epoch unchanged.
Abort leaves the epoch unchanged.
Deletion of an absent key is still a write.
Putting an identical value is still a write.
Replacing a staged operation on one key leaves one final write.
## Begin and lifetime
begin() returns a new independent transaction.
The transaction captures the current epoch at begin time.
Later commits do not change that snapshot.
Snapshot values must remain readable after newer commits.
A transaction starts active.
Successful commit closes the transaction.
Failed commit also closes the transaction.
Abort closes the transaction.
Any public operation on a closed transaction throws Error.
This includes repeated abort and repeated commit.
Validation occurs after the lifetime check.
Closing one transaction cannot close another.
## Keys and values
Keys are strings, including the empty string.
Non-string keys throw TypeError.
No key normalization is performed.
Ordering uses JavaScript string comparison and Array.sort without a comparator.
Values are JSON-compatible, including null, false, zero, arrays and objects.
undefined as the entire put value throws TypeError.
Values are cloned on input.
Values are cloned on output.
Mutating a returned array or object cannot mutate staged or stored values.
Mutating initial input after construction cannot mutate stored values.
## Point reads
get(key) returns a value or null for absence.
A live stored null also returns null.
A staged put takes precedence over the snapshot.
A staged deletion returns null.
An unstaged read observes the newest version at or before the snapshot.
An unstaged point read records the key in the read set.
Reading an absent key records it too.
Reading a staged key does not add a point dependency.
The write set already protects that key at commit.
Repeated reads have no additional observable effect.
has(key) returns whether a live key exists, distinguishing stored null from absence.
has records the same point dependency as get unless the key is staged.
has obeys key validation and closed transaction rules.
## Staging
put(key,value) stages a live value.
delete(key) stages a tombstone.
Neither operation changes the shared history before commit.
Neither operation implicitly reads the current value.
A write must nevertheless validate against changes after the snapshot.
put followed by delete leaves a tombstone.
delete followed by put leaves a live value.
Staged data is private to its transaction.
## Predicate reads
scan(from=null,to=null) returns ordered [key,value] pairs.
from is inclusive.
to is exclusive.
null denotes an unbounded endpoint.
A non-null endpoint must be a string.
from greater than to throws RangeError.
Equal endpoints describe an empty interval.
An empty interval is still a valid predicate dependency.
Invalid scans do not record dependencies.
The scan overlays all staged operations onto the snapshot.
A newly staged key appears if it lies in bounds.
A staged tombstone removes its key.
A staged replacement appears only once.
The returned outer list is fresh.
Each returned value is independently cloned.
A scan records its entire interval, not just returned keys.
Scans do not additionally record point dependencies.
A key outside an interval cannot cause a predicate conflict.
A key exactly at from belongs to the interval.
A key exactly at to does not belong to the interval.
## Savepoints
savepoint(name) records current writes, point reads and predicates.
Names are strings under the same key validation rule.
Names need not be unique.
Duplicate names form distinct stack entries.
rollback(name) targets the most recent matching savepoint.
An unknown name throws Error without changing state.
Rollback restores all three captured sets.
Rollback discards savepoints created after the target.
Rollback retains the target itself.
Rolling back repeatedly to the retained target is allowed.
Reads made after the target are forgotten.
Predicates made after the target are forgotten.
Writes made after the target are forgotten.
Earlier reads and predicates remain dependencies.
Savepoint captures must not alias the mutable current sets.
release(name) targets the most recent matching savepoint.
Release discards the target and all younger savepoints.
Release does not roll back writes or dependencies.
Release of an unknown name throws Error without changing state.
Commit is allowed with unreleased savepoints.
Abort discards all savepoints.
## Validation
commit() returns exactly {ok:boolean,epoch:number}.
The returned epoch is the shared epoch after the attempt.
Commit validates before publishing any staged write.
Every point-read key must have no version newer than the snapshot.
Every staged-write key must have no version newer than the snapshot.
Every recorded interval must contain no key with a version newer than the snapshot.
For predicate validation, include tombstones and keys currently absent.
An inserted then deleted key is still a predicate conflict.
A changed then restored value is still a point conflict.
A blind writer conflicts with a concurrent writer of the same key.
A blind writer need not conflict with an unrelated key.
Concurrent here means a commit after this transaction began.
Validation compares version epochs, not values.
A conflict returns ok=false and publishes no writes.
Every successful validation returns ok=true.
A read-only transaction can fail validation.
An empty transaction with no reads always commits successfully.
A failed transaction cannot be retried by calling commit again.
Call begin again to obtain another snapshot.
## Atomicity
One conflicting key aborts every staged write.
No prefix of the write set may become visible on failure.
Successful multi-key publication is one epoch.
All cloning needed for publication occurs before publication.
Different transactions may retain different snapshots indefinitely.
Tombstones must retain enough version identity for validation.
History reclamation is outside this revision.
## Error isolation
Unknown savepoint names do not close the transaction.
Invalid keys do not close the transaction.
Invalid bounds do not close the transaction.
Invalid values do not close the transaction.
A transaction may continue after those errors.
The shared database is unchanged by those errors.
No public method may mutate caller-owned arrays or objects.
The implementation may add source modules.
The implementation must not change tests or dependency declarations.
## Development
The basic visible suite covers the original point API.
This document defines the new revision and is authoritative.
Additional examples are not a substitute for interval validation.
All behavior is deterministic and requires no network.
