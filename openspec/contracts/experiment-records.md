# Contract: local manual experiment records (fusion 13.2)

This additive contract freezes this feature before implementation. Root contracts
remain authoritative; no native DTO, SQLite schema or original-source change.
Milestone: post-M12 fusion functional increment, not performance acceptance.

## EXP-001 — declarations and bounds

```ts
export type ExperimentLabel = 'pass' | 'fail' | 'mixed' | 'unrated';
export interface ExperimentRun {
  sessionKey: string;
  label: ExperimentLabel;
  note: string | null;
}
export interface ExperimentInput {
  name: string;
  task: string | null;
  inputVersion: string | null;
  modelParameters: string | null;
  toolSet: string | null;
  mode: 'controlled' | 'natural';
  runs: ExperimentRun[];
}
export interface ExperimentRecord extends ExperimentInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export interface ExperimentSnapshot {
  version: 1;
  revision: number;
  records: ExperimentRecord[];
}
```

All conditions and labels are user declarations, never verified measurements,
causal equivalence, quality scores or automated test results. `controlled` means
user-declared controlled conditions; natural traffic remains distinctly labelled.
Model AND parameters are one free-text declaration, not an executable settings map.
Unknown declarations/notes are null, default label unrated; never infer from logs.
Required name 1..120 UTF-16 units; optional task/modelParameters/toolSet<=2000,
inputVersion<=256, run note<=2000, sessionKey1..256; reject blank strings, NUL,
unknown/missing fields, duplicate run keys. 0..16 runs, 100 records maximum.
Input serialized UTF8<=16KiB, document<=1MiB, including JSON escaping.
Server-generated UUID v4 identities and ISO UTC timestamps; no client IDs/times.
Snapshot revision starts0 and increments once per mutation, safe integer; no reset
on delete-all and no overflow. Native session references are not foreign keys.
New run keys must resolve to existing scan sessions via one injected batch lookup;
unchanged old keys survive deletion. Lists never fetch native bodies. A reference
absent from the parent's loaded/filtered index is unavailable in that scope,
not proof of deletion; keep its key and label and disable its compare action.

## EXP-002 — storage and concurrency

Fixed app-owned config-directory file `experiment-records.json`. Asynchronous
bounded no-follow regular-file reads, exact schema checks, fail closed on corrupt,
unsupported/oversized/symlink files. Missing file is an empty revision0 snapshot.
Use exclusive .lock (no automatic stale-lock removal), UUID temp file mode0600,
fsync and atomic rename. Never touch Agent configs, source logs, DBs or captures.
No automatic mutation retry or waiting queue. Every mutation holds the file lock
while checking expectedRevision against the current on-disk snapshot. Conflict
requires explicit refresh/review; a create retried with an old revision cannot
silently duplicate. Cleanup verifies owned lock inode; IO/cleanup failure is an
uncertain local outcome and must not be presented as rollback. Crash lock recovery
requires explicit owner inspection. Durability across sudden power loss is not
certified; this uses the existing profile store's temp+fsync+rename convention.

## EXP-003 — HTTP

Register native Node handlers through existing Router, same loopback Host/Origin
policy and foreground tracking as existing protected routes; no-store responses.
- GET `/api/experiment-records` ->200 ExperimentSnapshot
- POST `/api/experiment-records` body `{confirmed:true,expectedRevision,record:ExperimentInput}` ->201 snapshot
- PUT `/api/experiment-records/:id` same body ->200 snapshot
- DELETE `/api/experiment-records/:id` body `{confirmed:true,expectedRevision}` ->200 snapshot

Mutation body<=20KiB with5s read deadline, JSON content type, exact fields.
Confirmation is mandatory; no automatic execution or paid calls.
Use existing ApiError envelope codes BAD_REQUEST for400/404/409/413 and
INTERNAL_ERROR for503, with `details.reason` stable values INVALID, NOT_FOUND,
CONFLICT, BUSY, LIMIT, UNAVAILABLE, SESSION_UNAVAILABLE. No filesystem error leaks.
A failed/aborted/timed-out write remains uncertain to clients until an explicit
successful read and user review; failed refresh never unlocks mutation retries.

## EXP-004 — UI and integration

Lazy mounted panel, parent-owned SessionIndexEntry[] only; no second session
store or per-session fetch. Initial list one GET; explicit read refresh/retry only,
5s read/10s write owned deadlines and cancellation/late-result suppression.
Bilingual UI states, keyboard focus trap/return, safe cancel default for create,
edit/delete and dirty-close confirmation. Cancel does not roll back a sent write.
Preserve draft and reviewed revision during refresh; require explicit reselection
before writing at a newer revision. Explicit comparison selects two distinct,
currently loaded scan refs and calls parent onCompare(left,right). No native writes.
Lists render20 records/page; run selector searches parent's loaded metadata with
at most50 matches. Explicit JSON download exports the loaded manual snapshot only;
no cloud upload. New UI copy is local bilingual dictionary due to file whitelist.
No fee/performance/soak workflows, automatic scoring, experiment runner or scheduling.
