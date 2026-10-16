## Context

See `proposal.md` for motivation and the capability deltas under `specs/` for observable
behavior. The current product stores provider-normalized sessions and events, derives
session turns on the client, and can display a limited agent hierarchy from merge groups.
That hierarchy is not a team execution model: it has no versioned task DAG, communication
stream, agent lifecycle, cross-agent clock, artifact lineage, or comparison basis.

The design is constrained by the existing contract priority, plain Node HTTP server,
SQLite WAL storage, React shell, four-runtime-dependency limit, tiered body disclosure,
coalesced SSE, and hard request/performance budgets. The worktree also contains other
uncommitted work; implementation must stay inside the file boundary frozen in `tasks.md`.

External product basis: Huawei Cloud's CodeArts Agent Team guide, updated 2026-08-14,
defines Leader orchestration, persistent independent Teammate contexts, bidirectional
member communication, a shared Task List with serial/parallel dependencies, dynamic
membership, Role/Scene templates, per-member To-Dos and tool use, artifacts, context
usage, failure recovery, and final Leader verification/integration:
`https://support.huaweicloud.com/usermanual-space/codeartsagent_space_0003.html`.
These documented capabilities inform the source inventory; they are not evidence that a
specific local run emitted every record needed to observe them.

## Goals / Non-Goals

**Goals:**

- Reconstruct a provider-neutral team run while preserving provider-native identities,
  relationships, ordering, and missing-data boundaries.
- Answer four questions without opening raw logs: who formed the team, how tasks and
  messages flowed, what each agent did over time, and which measurable trade-offs differ
  between two comparable runs.
- Keep topology, Task DAG, and execution ledger as separate views over one evidence set;
  disagreement between them is useful diagnostic data rather than something to hide.
- Make CodeArts Agent Team and Codex collaboration the first two team dialects while
  keeping the canonical model extensible to the other existing providers.
- Reuse session trajectories for event-level detail instead of creating a competing event
  model.

**Non-Goals:**

- Controlling, spawning, messaging, retrying, or modifying a running team. This feature is
  read-only observability.
- Assuming every team is a tree, every provider has three levels, or every task completion
  proves correctness.
- Inferring hidden chain-of-thought. Only reasoning text explicitly present in the source
  may be marked available, and body display remains on demand.
- An LLM-generated review, winner, or management recommendation. All summaries are
  deterministic consequences of declared metrics and thresholds.
- Cross-machine clock synchronization beyond reporting observed offsets/ambiguity.
- A generic distributed tracing standard or remote telemetry collector in this change.
- Retrofitting all historical merge groups into confirmed teams.

## Decisions

### D1. Discovery is a hard gate before contract freeze

Implementation begins with a read-only inventory of real local source formats, followed
by sanitized fixtures and a field-coverage matrix. No database field, API response, or
adapter mapping may be implemented until the matrix is reviewed against actual records.

The inventory covers:

| Dialect | Candidate source families | Facts to prove |
|---|---|---|
| CodeArts Agent Team | Agent Team application logs; CodeArts session SQLite/JSON; Task List/task overview; accepted artifact metadata; project-local Role/Scene files | run id, member id/role, Leader relationship, task/dependency/claim, message sender/recipient, lifecycle/recovery, tool/skill/MCP reference, token/context figures, artifact/verification |
| Codex collaboration | local Codex session JSONL/index/SQLite records and collaboration control events that are actually persisted | root/parent/child ids, task dispatch, peer/root messages, activity/turn links, tool calls/results, interrupt/follow-up/completion, output and integration |

For each canonical fact the matrix records: source field/path, cardinality, timestamp and
clock, native ordering, body sensitivity, stable id, nullable cases, real fixture id, and
confidence. Unsupported facts are deliberately left unavailable.

Alternative rejected: design from screenshots or product documentation. That produces a
beautiful but fictional telemetry contract and violates the project's evidence rule.

### D2. One normalized evidence graph, three projections

The canonical persisted model is an evidence graph plus an activity ledger. The UI
projects it into:

1. **Organization topology** — agent creation/supervision plus peer/cross-tree edges.
2. **Work topology** — versioned Task DAG, assignments, handoffs, artifacts, verification.
3. **Time topology** — per-agent rounds and activities on a shared wall clock.

Communication is both a first-class entity and a ledger activity. Tasks, agents,
messages, tools, artifacts, and session events join through stable ids, not title matching.

Alternative rejected: store one nested team JSON blob. It makes partial updates expensive,
prevents indexed time/graph queries, hides contradictions, and forces full-run reads.

Alternative rejected: extend `events` with all team concepts. Team assignments and
messages can exist without an agent session event, have different lifecycle semantics,
and would reopen the 96%-body-size problem.

### D3. Draft contract vocabulary

The contract-freeze batch copies the final definitions verbatim into
`contracts/data-model.md` and `src/core/trace-types.ts`. Names below are fixed unless D1
proves a provider collision that cannot be represented.

**Closed enums**

| Type | Members |
|---|---|
| `TeamTopologyKind` | `two_level`, `three_level`, `deep_tree`, `peer_graph`, `hybrid`, `unknown` |
| `EvidenceConfidence` | `native`, `correlated`, `inferred`, `unavailable` |
| `EvidenceDimension` | `topology`, `tasks`, `communication`, `timing`, `tools`, `outputs`, `tokens`, `cost`, `verification` |
| `CompletenessLevel` | `complete`, `partial`, `unavailable`, `conflicted` |
| `TeamRunStatus` | `planned`, `running`, `blocked`, `success`, `error`, `cancelled`, `unknown` |
| `TeamAgentState` | `created`, `ready`, `busy`, `blocked`, `idle`, `failed`, `replaced`, `cancelled`, `completed`, `unknown` |
| `TeamTaskStatus` | `pending`, `ready`, `claimed`, `running`, `blocked`, `completed`, `failed`, `cancelled`, `unknown` |
| `TeamAgentEdgeKind` | `created`, `supervises`, `coordinates`, `reviews`, `replaces`, `peer` |
| `TeamActivityKind` | `agent_lifecycle`, `task_created`, `task_dependency`, `task_assignment`, `task_status`, `round`, `message_sent`, `message_received`, `tool_call`, `tool_result`, `artifact`, `verification`, `handoff`, `error`, `recovery`, `integration`, `unknown` |
| `TeamMessageMode` | `direct`, `leader_mediated`, `broadcast`, `unknown` |
| `TeamMessageCategory` | `assignment`, `coordination`, `question`, `answer`, `handoff`, `status`, `blocker`, `review`, `correction`, `result`, `system`, `unknown` |
| `ComparisonMatch` | `matched`, `partially_matched`, `unmatched`, `unknown` |

**Core records and required identity fields**

| Record | Required fields; optional/null fields are frozen in the contract |
|---|---|
| `EvidenceRef` | `id`, `sourceKind`, `sourceLocator`, `nativeId`, `nativeSequence`, `capturedAt`, `confidence`, `parserVersion` |
| `TeamRunSummary` | `id`, `provider`, `nativeRunId`, `title`, `goalFingerprint`, `status`, `startedAt`, `endedAt`, `topologyKind`, counts, token/cost availability, `updatedAt`, `stamp` |
| `TeamRunSnapshot` | summary, agents, agent edges, tasks, dependencies, current assignments, artifact metadata, completeness, anomalies, metrics; never activity/message/tool bodies |
| `TeamAgent` | `id`, `runId`, `nativeId`, `displayName`, `role`, `roleClass`, `model`, `state`, `createdAt`, `endedAt`, `sessionKeys`, `evidenceIds` |
| `TeamAgentEdge` | `id`, `runId`, `fromAgentId`, `toAgentId`, `kind`, `validFrom`, `validTo`, `confidence`, `evidenceIds` |
| `TeamTask` | `id`, `runId`, `nativeId`, `title`, `descriptionAvailable`, `priority`, `status`, lifecycle times, `resultAvailable`, `evidenceIds` |
| `TeamTaskDependency` | `id`, `runId`, `upstreamTaskId`, `downstreamTaskId`, `validFrom`, `validTo`, `confidence`, `evidenceIds` |
| `TeamAssignment` | `id`, `runId`, `taskId`, `agentId`, `assignedAt`, `unassignedAt`, `assignmentKind`, `evidenceIds` |
| `TeamCommunication` | `id`, `runId`, `senderAgentId`, `recipientAgentIds`, `mode`, `category`, `taskId`, `correlationId`, `replyToId`, `sentAt`, `receivedAt`, `bodyAvailable`, `evidenceIds` |
| `TeamActivitySlim` | `id`, `runId`, `agentId`, `taskId`, `roundId`, `kind`, `status`, `startedAt`, `endedAt`, `nativeSequence`, entity/session/event links, token/cost metadata, body flags, `evidenceIds`, order ambiguity |
| `TeamRound` | `id`, `runId`, `agentId`, `nativeId`, `index`, `segmentationSource`, times, status, task/activity/output links, aggregates, completeness |
| `TeamArtifact` | `id`, `runId`, `nativeId`, `name`, `kind`, `pathRedacted`, `contentHash`, `producerAgentIds`, `taskIds`, `createdAt`, `acceptedAt`, body flags, evidence |
| `TeamMetrics` | metric version, criteria, availability, all scheduling/quality/stability/cost/collaboration values plus supporting ids |
| `TeamComparison` | left/right ids, basis, dimension sections, raw/delta values, strengths, weaknesses, trade-offs, caveats, generatedAt |

`TeamActivitySlim` does not add `raw`, message text, tool arguments/results, reasoning, or
artifact content. Detail types add only the explicitly requested body tier.

### D4. Identity and provenance

Identity preference order:

1. provider-native globally unique id;
2. provider-native id scoped by native run id;
3. deterministic SHA-256 over provider, redacted source locator, run identity, entity
   kind, native/local identity, and occurrence ordinal.

Display names, roles, titles, and timestamps never participate alone. Duplicate native ids
gain a deterministic occurrence ordinal while retaining the duplicate in evidence.

Evidence confidence is assigned per fact, not per run:

- `native`: record explicitly states the fact.
- `correlated`: explicit stable ids join two native records.
- `inferred`: documented heuristic such as a legacy subagent-title pattern.
- `unavailable`: the fact cannot be obtained.

Conflicting native/correlated facts coexist and mark the dimension `conflicted`. The UI
defaults to native + correlated evidence; inferred evidence is an opt-in overlay. Metrics
dependent on excluded/conflicted facts become unavailable.

Alternative rejected: one confidence flag on the whole run. A run can have native tasks,
correlated sessions, inferred parentage, and unavailable messages simultaneously.

### D5. Topology derivation

Topology is computed from active `created` and `supervises` edges after applying the
evidence filter. `coordinates`, `reviews`, `replaces`, and `peer` edges are overlays and
do not silently change parentage.

Algorithm:

1. Validate referenced nodes, self-edges, duplicate edges, active-time intervals, cycles,
   roots, and multiple active parents.
2. If structural evidence is absent and peer edges exist, classify `peer_graph`; if both
   are absent, `unknown`.
3. A single-root, acyclic, single-parent graph is a tree. Count occupied levels from root
   as level 1: two → `two_level`, three → `three_level`, more → `deep_tree`.
4. A valid structural tree plus material cross-tree/peer execution edges is `hybrid`.
5. Cycles, irreconcilable roots, or parent conflicts make classification `unknown` and
   emit anomalies; the raw graph remains viewable.

“Material” means an overlay edge is linked to a task, handoff, review, blocker, or result;
mere heartbeat/status chatter does not reclassify a tree. Classification is recomputed
for time slices because membership and relationships are versioned.

Alternative rejected: set topology from provider (`codex = three_level`, `codearts =
two_level`). The same engine can create different shapes per run.

### D6. Task DAG and assignment history

Tasks and dependencies are versioned entities. Current task state is a derived projection
of lifecycle events; source history is never overwritten. Assignment is many-to-many over
time so shared claim, paired review, reassignment, and replacement remain representable.

Task DAG validation reports:

- missing upstream/downstream task;
- self/cyclic dependency;
- task starts before a required dependency completes;
- running/completed task with no owner;
- owner active outside agent lifetime;
- completed task without result;
- completed task without independent verification;
- conflicting current owners where the source does not declare shared work.

No validation rewrites source truth. The critical-path calculator excludes invalid
components and reports why.

### D7. Communication model

One logical communication record contains sender and recipient set. When the source emits
separate send and receive records they link to the logical message via stable native or
correlation id and remain separate ledger activities. A broadcast is one logical message
with multiple recipients, not N duplicated bodies.

Delivery-mode classification uses explicit source fields first. Leader-mediated requires
two observed hops; it is never inferred from the leader being present. Request/reply
latency requires `replyToId` or a native correlation id. Timestamp adjacency is not
enough.

Bodies live in the detail tier. Slim communication stores bounded metadata, body byte/
character counts, content hash after desensitization, and availability. This allows
duplication/repetition analysis without shipping content.

### D8. Activity ordering and per-agent rounds

The unified ledger is append-oriented and ordered by:

1. provider-native sequence within the same source stream;
2. normalized UTC `startedAt` across streams;
3. source priority frozen per adapter;
4. canonical activity id as deterministic final tie-breaker.

If rules 2–4 decide ordering because no shared sequence exists, activities carry
`orderConfidence = ambiguous`. The UI shows an uncertainty marker and metrics avoid
causal latency for that pair.

Round boundary priority:

1. provider-native agent round id;
2. explicit link to an existing session turn;
3. existing session `TurnModel` segmentation source;
4. unavailable — render event ledger without rounds.

Time gaps and fixed event counts are forbidden fallbacks. Parent and child intervals
remain on separate lanes. A parent waiting for a child is `blocked`/`waiting` only if a
lifecycle/task record says so; no activity alone yields an `unknown` gap.

### D9. Metrics and formulas

Every metric is `{ value, available, complete, criteria, evidenceIds }`; counts are zero
only when the relevant dimension is complete and the observed count is truly zero.

**Scheduling**

| Metric | Formula / rule |
|---|---|
| `wallClockMs` | run end minus run start; end null while running |
| `agentActiveMs` | interval union of measured active activities per agent |
| `totalWorkMs` | sum of `agentActiveMs`; measured, not wall-clock |
| `observedWaitMs` | union of explicit wait/blocked intervals only |
| `maxConcurrency` | maximum simultaneous agents with active intervals |
| `avgConcurrency` | integral of active-agent count divided by wall-clock |
| `serialWorkEstimateMs` | sum of measured task active durations; label estimate |
| `observedSpeedup` | serial-work estimate / wall-clock; unavailable if either is invalid |
| `peakCapacityUtilization` | totalWork / (wall-clock × maxConcurrency), valid only for a complete interval window |
| `criticalPathMs` | longest weighted path over complete acyclic Task DAG |
| `delegationDelayMs` | first child creation/assignment minus run start |
| `handoffLatencyMs` | next owner's first related activity minus explicit handoff time |

**Accuracy/quality**

- task completion = completed tasks / terminal tasks, with cancelled reported separately;
- verification coverage = completed tasks with independent verification / completed tasks;
- acceptance coverage = acceptance criteria with passed evidence / criteria with known
  outcome; unavailable without criteria evidence;
- review rework = correction/reopened tasks after review;
- accepted artifact rate uses explicit acceptance only.

**Stability**

- failures, retries, replacements, recovery latency, blocked/orphan time, unresolved
  errors, DAG anomalies, and incomplete terminal states;
- a later success does not erase the preceding failure/retry.

**Cost**

- reuse `TokenUsage` and `CostSource` rules;
- totals by agent/task/round and Gini distribution;
- coordination tokens count only message/orchestration activities explicitly labelled by
  the source; unknown classification makes coordination overhead unavailable.

**Collaboration**

| Metric | Rule |
|---|---|
| direct ratio | direct messages / messages with known delivery mode |
| leader-mediated ratio | leader-mediated messages / messages with known delivery mode |
| response latency | correlated request/reply only; median and P95 |
| task-balance Gini | completed task active duration by agent; task count is secondary |
| leader work concentration | leader active time / total work, descriptive |
| critical-agent concentration | critical-path time attributed to top agent / critical path |
| cross-agent review | tasks verified/reviewed by an agent other than the producer |
| duplicate-work signal | overlapping task/artifact hashes or same path+time with explicit conflict; heuristic, always labelled inferred |

Alternative rejected: one collaboration score. Ratios can move in opposite directions and
their desirability depends on task shape.

### D10. Comparison basis and deterministic verdicts

`POST /api/team-compare` receives left/right run ids and an optional explicit manual-basis
declaration. The service builds a basis from:

- desensitized goal fingerprint and acceptance-criteria fingerprint;
- repository/workspace identity without exposing an absolute personal path;
- starting revision/dirty-state fingerprint when observable;
- environment fingerprint (OS/runtime/toolchain fields present in both runs);
- provider, model, team template/scene/role set;
- run completeness by evidence dimension.

Matching rules:

| Result | Rule |
|---|---|
| `matched` | same goal/criteria and starting state, or explicit experiment id, with all material fields known |
| `partially_matched` | goal matches but one or more starting/model/environment fields differ or are unknown |
| `unmatched` | goal, project, acceptance criteria, or starting state materially differs |
| `unknown` | evidence is too incomplete to decide |

A manual declaration can enable normalized deltas for `partially_matched`; it cannot erase
the differences. It does not turn a detected `unmatched` pair into a system-asserted
match—the report says the basis is user-declared.

Metric rows carry raw left/right, `delta = right - left`, relative delta only for a finite
non-zero left value, directionality, materiality threshold, completeness, and criteria.
Strength/weakness sentences are selected from the largest material, complete,
direction-aware deltas per dimension. A caveat is mandatory for each excluded dimension
and for every provider/evidence difference that could reverse the conclusion.

Alternative rejected: LLM-written team review. It is non-reproducible, can overclaim from
missing evidence, and would add cost/network work to a local arithmetic feature.

### D11. Database layout and migration

The contract-freeze batch adds the next schema migration from the then-current version
(expected v8 → v9 only if no preceding change advances it). It is additive and creates:

| Table | Purpose | Body policy |
|---|---|---|
| `team_runs` | identity, lifecycle, topology, counts, fingerprints, stamp | no bodies |
| `team_agents` | participant identity, role/model/state/lifetime | no bodies |
| `team_agent_edges` | versioned structural/overlay relationships | no bodies |
| `team_tasks` | slim task identity/state/times/body flags | no descriptions/results |
| `team_task_dependencies` | versioned DAG edges | no bodies |
| `team_assignments` | versioned task ownership | no bodies |
| `team_messages` | slim logical communication metadata | no message body |
| `team_activities` | ordered slim execution ledger | no tool/raw/artifact body |
| `team_rounds` | per-agent round boundaries and aggregates | no bodies |
| `team_artifacts` | metadata, redacted path, hash, acceptance | no content |
| `team_evidence` | locators, native ids/sequences, confidence, parser version | no source body |
| `team_activity_bodies` | optional desensitized input/output/message/result plus raw reference/body | detail-only |
| `team_metrics` | versioned per-run aggregate JSON/columns needed by list/compare | no bodies |

`team_runs` may link to sessions through a junction table rather than a body-bearing JSON
array when D1 shows many-to-many membership. Foreign keys cascade inside team-owned
tables. Session deletion clears the junction and event link but does not delete the team
run; team deletion does not delete sessions.

Core indexes match actual predicates:

- `(run_id, started_at, native_sequence, id)` on activities;
- `(run_id, agent_id, started_at, id)` and `(run_id, task_id, started_at, id)`;
- `(run_id, sender_agent_id, sent_at)` plus a normalized recipients junction index;
- `(run_id, status, started_at)` for tasks;
- `(run_id, from_agent_id, to_agent_id, kind)` for relationships;
- `(run_id, updated_at DESC)` for artifacts and evidence;
- run list indexes for provider/status/started time.

The exact DDL and column constants live only in `contracts/database.md`; no code is written
from this summary. Every migration test covers fresh DB, previous→next, repeated init,
newer-version refusal, rollback-safe failure, and preservation of existing tables.

### D12. Differential ingestion and parser-version invalidation

Each source has a team scan-state fingerprint including relevant sidecar/WAL files and the
team parser version. Unchanged fingerprint + parser version returns before parse or SQL.

Ingestion is transactional and differential:

1. normalize and deduplicate a complete snapshot or append batch;
2. read existing ids for affected runs/entities;
3. insert/update only changed slim/detail rows;
4. delete stale derived rows only when the source proves a complete replacement snapshot;
5. recompute affected topology/task/metric projections;
6. update scan state and emit one coalesced team change.

Tail or interrupted scans never infer deletion. A parser-version change invalidates only
derived team rows for affected source runs and regenerates them from original source; it
does not touch sessions/events or raw source files.

Alternative rejected: delete-and-reinsert each team run. Long-running teams can contain
100,000 activities, so full rewrites amplify WAL and destroy stable patch identities.

### D13. HTTP contract

Routes follow existing plural-resource conventions and `ApiError`. Exact response types
are frozen in `contracts/api.md` before server work.

| Route | Behavior |
|---|---|
| `GET /api/team-runs` | keyset-paginated slim run list; provider/status/topology/range/search/completeness filters |
| `GET /api/team-runs/:runId` | one bounded `TeamRunSnapshot`; topology, task graph, artifact metadata, completeness, metrics; no activity or body payload |
| `GET /api/team-runs/:runId/activities` | keyset-paginated slim ledger; agent/task/kind/status/time filters |
| `GET /api/team-runs/:runId/activities/:activityId` | one detail; `include=body` or `include=raw` explicitly controls tiers |
| `GET /api/team-runs/:runId/patch` | stamp + bounded agent/task ids; returns changed/deleted slim entities for SSE local patch |
| `POST /api/team-compare` | `{leftRunId,rightRunId,manualBasis?}` → one bounded comparison response |
| `DELETE /api/team-runs/:runId` | explicit local derived-team deletion only; does not delete linked sessions/source files |

Snapshot deliberately bundles summary, agents, edges, tasks, dependencies, assignments,
artifact metadata, completeness, anomalies, and metrics. Splitting those into six routes
would create a waterfall without reducing bytes. Activities remain separate because they
are large and paginated.

New stable error codes: `TEAM_RUN_NOT_FOUND`, `TEAM_ACTIVITY_NOT_FOUND`,
`TEAM_SOURCE_INCOMPLETE`, `TEAM_BODY_UNAVAILABLE`, `TEAM_COMPARE_INVALID`, and existing
`BAD_REQUEST` for bounds. An unmatched comparison is a successful descriptive response,
not an error.

All list/snapshot/ledger/compare responses are gzip-aware. Cursor, id-list, time-window,
filter-count, and detail-size bounds are explicit in the API contract. No route reads a
large source file, spawns a process, or computes a full run on the request path.

### D14. Realtime contract

Add one `team_runs_changed` bus/SSE event:

```ts
{
  runIds: string[];
  agentIds: string[];
  taskIds: string[];
  truncated: boolean;
  stamp: string;
}
```

The existing 200ms coalescer maintains sets and caps each id list (contract default: 200).
Above the cap it retains run ids, sets `truncated`, and the open run performs one snapshot
refresh. Within the cap, the client calls one patch route. No activity ids are broadcast;
the ledger invalidates pages intersecting the changed run/time stamp.

The reconnect path compares stamps and performs at most one snapshot + one visible ledger
page request. Selected entities, graph zoom, filters, scroll position, and expanded body
caches survive when their ids still exist.

### D15. Frontend information architecture

The top navigation becomes `Sessions | Teams | Agents | Compare | Proxy | Frida | Mission`.
Session Compare remains session-level; Team Compare lives under Teams and has its own hash
route. This avoids overloading two different comparison contracts.

Team view layout:

```
┌ TeamRunList 300px ┬ Team main ─────────────────────────────┬ Inspector 360px ┐
│ filters + runs    │ summary + completeness                  │ selected entity │
│ topology badges  │ [Topology][Tasks][Timeline][Comms]      │ evidence/body   │
│ status/counts    │ graph / DAG / swimlanes / ledger        │ session jump    │
└──────────────────┴──────────────────────────────────────────┴─────────────────┘
```

The main subviews share one normalized entity store. A selection is a tagged union
`agent | task | round | activity | message | artifact | edge`; each subview maps it to
its own highlight without issuing a request. The inspector alone may fetch one body.

- Topology renders the structural tree with SVG/DOM using existing primitives; peer/cross
  edges are an overlay. No graph runtime dependency is added.
- Task view uses DAG levels from server metadata, highlights critical path only when
  available, and shows cycles/missing edges directly.
- Timeline uses a shared wall-clock scale, virtualized agent lanes, minimum-width point
  markers, level-of-detail aggregation, and uncertainty bands.
- Communication view uses directed edges plus a virtualized message table; graphs are
  descriptive when bodies are unavailable.
- Ledger is the authoritative chronological reading view and stays available when graph
  projection fails.

Team Compare has selectors, a persistent basis banner, side-by-side summary/topology/
schedule cards, five dimension tables, and deterministic strengths/weaknesses/trade-offs.
There is no radar-only verdict or overall score; exact values and caveats are primary.

Every graph interaction is keyboard-reachable. Nodes/edges/intervals have text names;
shape/icon/text accompany color. All strings land in both locales. The shell continues to
use `App.tsx` as the only stateful owner; feature-local stores are derived caches, not a
second run-list source of truth.

### D16. Provider adapter boundaries

Team parsing is isolated behind a `TeamDialectAdapter` contract conceptually exposing:

- `discoverTeamRuns(source): TeamRunCandidate[]`;
- `parseTeamRun(candidate): NormalizedTeamEvidence`;
- `capabilities(candidate): EvidenceCompleteness`;
- `fingerprint(source): string`.

It does not replace the existing session adapter. The scanner can run both paths over a
source and link them by native ids. Shared normalization helpers cover ids, timestamps,
confidence, source order, redaction, and lifecycle validation; provider-specific code owns
record shape and semantics.

CodeArts decisions:

- distinguish Team Leader, Teammate, Role, Scene, and transient Subagent instead of mapping
  them all to one generic label;
- Task List is team-global; To-Do remains agent-local metadata/activity, not a team DAG task
  unless the source explicitly links/promotes it;
- direct teammate communication stays direct;
- template files describe intended roles/scene, never prove runtime membership;
- accepted artifact state and final Leader verification are separate events.

Codex decisions:

- parentage follows persisted creation evidence; provider name never implies three levels;
- root, collaborative, and leaf are derived level/behavior labels, not hard-coded roles;
- follow-up, interrupt, completion, peer/root messages, and task updates remain distinct;
- session/tool events link to team activities rather than being copied.

### D17. Performance budgets and scale ceiling

Add a team tier-B ceiling to `contracts/nfr.md`: 500 team runs total; one large run with
100 agents, 1,000 tasks, 20,000 communications, and 100,000 activities. Hard budgets:

| Scenario | Budget |
|---|---|
| team list, 500 runs | < 10ms DB / < 80KB gzip |
| run snapshot, 100 agents + 1,000 tasks | < 100ms / < 750KB gzip |
| ledger page, 200 activities | < 50ms / < 200KB gzip |
| one body detail | < 20ms, bounded by existing detail limits |
| two-run comparison | < 300ms cold / < 20ms stamp-cache hit / 1 request / < 250KB gzip |
| topology/DAG projection | < 50ms each at ceiling |
| timeline first meaningful paint | < 2s; stable DOM nodes while scrolling |
| SSE/request behavior | no per-entity SSE; <15 API requests in a 30s steady window |
| event-loop delay | p99 < 50ms during ingest and compare |

Snapshot and compare use stamp caches. Heavy graph/metrics recomputation occurs after
ingest, between foreground-yield points, and is persisted by calculation version. Request
handlers read bounded projections only.

Escalation signals: >500 agents requires graph clustering beyond role/task grouping;
>1,000,000 activities per run requires partitioned activity storage; >5,000 team runs
requires server-side FTS; source parsing >10s moves to worker threads. None is implemented
early.

### D18. Privacy and security

- Goal and acceptance criteria use desensitized normalized fingerprints in list/compare;
  full text is never returned there.
- Absolute home/workspace paths use the existing redaction convention.
- Message, reasoning, task description/result, tool input/output, raw records, and artifact
  contents pass through desensitization before persistence/response and stay detail-only.
- Source locators exposed to the UI are opaque/redacted; raw local paths remain server-side.
- No team API executes a source-provided command or renders unsanitized HTML.
- Deleted derived team data is recoverable only by rescanning the still-existing source;
  the delete confirmation says linked sessions and sources are untouched.

Alternative rejected: persist all raw Agent Team logs for convenient reprocessing. The
source already exists locally; duplication increases privacy risk and database size.

### D19. Implementation file boundary

The detailed task file freezes exact files after D1. Expected areas are limited to:

- the four authoritative contracts and relevant main specs/gotchas/baseline;
- new team scanner/adapter modules and colocated fixtures/tests;
- storage schema/columns plus new team storage/query/metrics modules and tests;
- HTTP registration/types/tests in the existing server entry paths;
- realtime event contract/coalescer tests;
- new `src/core/team-*` pure modules/tests;
- new `src/components/team/` components/tests, existing shell/hash/API/i18n/styles entry
  points, and no generated file hand edits.

No existing unrelated dirty file is included merely to make a global gate green. If a
required edit falls outside the frozen list, implementation stops and amends the design/
tasks before touching it.

## Risks / Trade-offs

- **Provider logs omit important events** → publish the coverage matrix, keep dimensions
  independently unavailable, and prohibit empty-as-zero comparison.
- **Cross-source clocks disagree** → prefer native sequence, mark ambiguous cross-source
  order, exclude ambiguous pairs from causal latency/critical-path facts.
- **Topology is graph-shaped, not a tree** → store a graph; tree is only a projection and
  `hybrid`/`unknown` are valid outcomes.
- **Task DAG changes during execution** → version edges/assignments and compute metrics on
  the chosen final or time-sliced projection with criteria.
- **Generic activity table becomes too polymorphic** → keep strict closed kinds and entity
  reference checks; provider-native payload remains evidence/detail, not schema columns.
- **100,000-activity runs stress SQLite/React** → composite indexes, keyset pagination,
  slim rows, precomputed projections, virtualization, level of detail, and measured gates.
- **Comparison rewards messaging volume** → communication volume is descriptive; quality
  metrics focus on latency, bottlenecks, review, handoff, and outcome evidence.
- **Manual match override invites overclaiming** → preserve a visible user-declared marker
  and all detected differences; never convert it into system-proven causality.
- **New schema migration overlaps another in-progress change** → select the next version at
  contract freeze, rebase migration tests on the authoritative database contract, never
  edit historical migration semantics silently.
- **Body desensitization removes useful debugging context** → keep hashes, sizes, category,
  and evidence locator; allow explicit local detail according to existing privacy policy.

## Migration Plan

1. Run D1 discovery and commit only sanitized fixtures/coverage matrices.
2. Freeze data model, DDL/migration, API, NFR, bus events, exact error codes, and output
   file list; validate OpenSpec and typecheck before implementation.
3. Ship additive schema + storage/query tests. Rollback remains possible by running the
   previous binary; it ignores additive tables. It MUST NOT downgrade the schema marker,
   so a documented backup/restore path is required before migration.
4. Ship CodeArts and Codex team adapters behind provider capability detection. Existing
   session scanning remains unchanged when no team source is found.
5. Backfill derived team rows from local sources in background with foreground yielding;
   no HTTP request waits for it. Team list shows scanning/partial until complete.
6. Ship team API/realtime, then pure metrics/topology/task projection, then frontend and
   compare in contract-first batches.
7. Validate sanitized fixtures, real CodeArts and Codex runs, HTTP contracts, request
   counts, accessibility, privacy scans, full project gates, and performance baseline.
8. Rollback UI/API by disabling team capability exposure; preserve additive tables for a
   later retry. Destructive removal requires a separate explicit migration and is not part
   of rollback.

## Open Questions

None that can safely remain open before implementation. Exact provider record paths and
fields are discovery outputs governed by D1; if either provider lacks stable evidence for
a required core identity (run or agent), implementation stops at the contract-freeze gate
and reports the affected requirements instead of weakening them.
