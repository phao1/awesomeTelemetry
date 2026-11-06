# RSI requirements — M13 / P1

Authority: [rsi.md](../../contracts/rsi.md), RSI-001..010, including the author's
decisions of 2026-11-07. Scope is executable contracts and non-HTTP/non-container
core only. Existing application routes, screens and dependencies SHALL NOT change.

## REQ-001 Exact types and validated entities
Adopt RSI-002 types verbatim. Validate required fields, units, nullability, UTC
dates, enums, IDs, full commits and SHA256 before ledger/cache writes; reject
unknown fields. Test contract/source parity, malformed fields and partial payloads.

## REQ-002 Task transitions and budget pause
Implement every RSI-003 task transition and reject every unlisted state/event/actor
combination. Budgets pause, stuck/sealed exhaustion request help, target completes.
Resume SHALL require available budget and return to calibration if incomplete.
Test every table row, guard and illegal combination; completed final/adopt commands
do not restart scheduling. Task-level interrupted evaluations are invalidated.

## REQ-003 Iteration transitions and human holds
Implement every RSI-003 iteration row, preserving rejected/promoted terminal
history. Only human events leave held. Missing reviews require retry_review;
incomplete comparison requires retry_evaluation. Approval must name exact allowed
categories and a reason; never bypass prior training, sealed or final gate.
Test every row and all illegal combinations, including worker/monitor approvals.

## REQ-004 Deterministic noise calibration
Use all R(R-1) ordered score differences and sample denominator n-1, delta=2*SD.
Require >=2 repetitions of the same planned set. Test known numeric result,
identical scores delta0, fractional baseline mean and invalid/repeated question IDs.

## REQ-005 Infrastructure and frozen scoring
Final unresolved infra ratio uses planned slots after one retry. Above .10 marks
infra_failed; any unresolved/missing slot prevents calibration. No score from
infra_failed/invalidated evaluations. Agent timeout/token429 are fail. Freeze
candidate first trainScore; confirmation runs only inform stability. Test ratio
boundary, sparse evidence, fractional sealed mean, retry restrictions and freezes.

## REQ-006 Five-condition promotion priority
Return verdict and all five structured conditions. Prioritize hard L0/L1 reject,
then missing/suspicious reviews, primary gain>delta, sealed>=parent-delta, stable
regression, token growth hold. No required review can be skipped. Test each
independent failure, combined priority, equality boundaries and missing evidence.

## REQ-007 Stable lineage regressions
Only the last stableWindow=3 ancestor passes and stableFailRepeats=2 consecutive
candidate failures regress. Single flips, short history and infra gaps do not.
Test chronological lineage windows, pass interruptions and repeated confirmations.

## REQ-008 Parent selection and rollback
Select latest baseline/promoted version inside best trainScore minus delta.
Explicit human baseline/promoted parent wins. Never describe this as a confidence
interval. Test ties, boundary equality, rejected versions and manual rollback.

## REQ-009 Sealed reservations and final locks
Candidate three-repeat sealed groups consume one nonrefundable reservation before
execution; baseline sealed calibration is free. Zero budget enters needs_help.
Completed sealed evidence survives token-growth approval. Final (task,commit) can
be reserved once by a human, with completion/results permanently locked. Test
budget guards, nondecreasing counters, final duplicate reservation and cache replay.

## REQ-010 Explicit human approval scope
Only dependency_change, l3_suspicious, l4_suspicious, token_growth can be waived,
bound to iteration+commit and a nonempty reason. No hard rejection or incomplete
evidence waiver. Test cross-candidate approvals and renewed full gate evaluation.

## REQ-011 Optimizer allowlist projection
Implement every RSI-005 projection with fresh explicit objects. Sealed yields only
accept/reject, final nothing, monitor held/category only. Drop unknown nested
fields and all raw test/assertion/monitor bodies and private paths. Test injected
sealed scores, question IDs, hidden tests, hashes and arbitrary monitor prose.

## REQ-012 Reusable fingerprint dictionary
L1 SHALL depend only on diff, metadata and pure validation/types. Normalize case,
Unicode and separators; filter short/common/low-entropy values deterministically.
Dictionary version/config/sorted entries follow RSI-006. Test known metadata
sources, corpus frequency, duplicates, determinism and no input mutation.

## REQ-013 L1 added-content cheating checks
Scan added lines in code, prompts, skills, tool descriptions and resources;
report file and new-file line. Decode long base64/hex once and rescan. Test benign
diffs and per-question branching, hardcoded answers and encoded answer injection.
Document concatenation/general semantic obfuscation limits.

## REQ-014 L1 structural protections
Independently report protected paths, dependency changes, binary files, modes,
symlinks, opaque blocks and oversized diffs. Check old/new/rename/delete paths;
lockfiles request human review, protected test/CI ancestors still reject. Test
deleted detector markers, escaped Git paths, mode-only changes and size boundaries.

## REQ-015 Canonical durable append-only ledger
Use RSI-007 canonical JSON, full hash chain, seq and task identity. Snapshot inputs
before queue waits; append LF then fsync file/directory. All file APIs asynchronous,
reads streaming with bounded lines. Test canonical vectors and invalid JSON types.

## REQ-016 Concurrent ledger ownership
Serialize in-process and cross-process with O_EXCL owner lock. Expired live or
unknown owners SHALL NOT be stolen; only known-dead, old locks recover under a
second exclusive guard. Test genuine multiprocess contention, dead/live/malformed
locks, timeouts and failed append queue recovery, with no lost/duplicate sequences.

## REQ-017 Ledger integrity and crash tails
Detect mutation, deletion, insertion, reorder, duplicate seq, broken chain and
trusted-head tail truncation. Report partial tails separately, fail closed without
discarding bytes. Unknown anchors disclose inability to prove tail completeness.
Test every corruption separately, valid newer prefixes and partial crash records.

## REQ-018 Atomic additive schema25
Add only nine RSI tables/eight explicit indexes, explicit column constants and
atomic schema24→25. Fresh/repeated initialization is idempotent. Test rollback on
version write failure, existing native row preservation and exact SQL/column parity.

## REQ-019 Cache replay and immutability
Cache is rebuilt only from validated ledger snapshots. Incremental entity+head is
atomic; current exact replay idempotent. Enforce same-task references, immutable
evidence/identity/first scores/locked results and immutable queued commands. Test
all-table row-for-row rebuild equality, invalid chains/partial tails, unrelated
task preservation, trusted anchors and concurrent head CAS without partial writes.

## REQ-020 Queue-only HTTP contract
Document all request/response DTOs, optimizer task bearer isolation, local human
token plus Host/Origin checks, unified ApiError and idempotent queued mutations.
P1 SHALL NOT implement handlers, executions or pages. Test queue payload/actor
validation and deny optimizer final/adoption commands; HTTP integration is deferred.

Referenced gotchas: [G14.1–G14.8](../../gotchas.md#14-rsi-m13--p1).
