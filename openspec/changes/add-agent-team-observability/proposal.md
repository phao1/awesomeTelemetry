## Why

Agent Observability can currently explain one session and a loosely merged subagent
group, but it cannot reconstruct a team as an execution system: who existed, which
agent created or coordinated whom, how work and messages flowed, what each agent did in
each round, or whether parallelism improved the result. That gap prevents an evidence-
based comparison between a CodeArts Agent Team, a Codex collaboration, or two runs of
the same team template.

## What Changes

- Add a first-class **team run** whose evidence-backed graph contains the orchestrator,
  collaborative agents, leaf agents, task DAG, communication edges, artifacts, and the
  sessions/events belonging to each participant.
- Normalize different products without forcing one architecture onto another: a run may
  be flat, two-level leader/teammate, a clear three-level
  Orchestrator → Collaborative Agents → Leaf Agents tree, a deeper tree, or a non-tree
  collaboration graph. Every relationship carries source and confidence.
- Add a unified execution ledger that answers, for every agent and round: active time,
  assigned task, state transition, input/output message, tool invocation/result,
  produced artifact, error, retry, handoff, and verification evidence.
- Add communication and coordination analysis: direct versus leader-mediated messages,
  request/reply links, broadcasts, handoffs, blockers, conflict/review loops, idle waits,
  critical path, and concurrency over time.
- Add a dedicated Teams view with topology, task-DAG, swimlane timeline, agent/round
  inspector, communication graph, evidence-completeness banner, and links back to the
  existing session trajectory surface.
- Add two-run Team Compare with matched-scope checks and separate Speed · Accuracy ·
  Stability · Cost · Collaboration results. It reports measured facts, trade-offs, and
  data gaps; it does not declare a winner when evidence or workload comparability is
  insufficient.
- Add incremental ingestion for CodeArts Agent Team and Codex collaboration traces. A
  provider missing an event type remains observable at a lower completeness level; the
  system never fabricates parentage, messages, tool calls, timing, or outputs.
- Extend live updates and performance budgets so a running team can be followed without
  per-agent polling or loading message/tool bodies by default.

## Capabilities

### New Capabilities

- `agent-team-observability`: Team-run identity, topology and task-DAG reconstruction,
  communication semantics, execution-ledger behavior, provenance/completeness rules,
  critical-path and concurrency analysis, and fair two-team comparison.

### Modified Capabilities

- `adapters`: Detect and normalize CodeArts Agent Team and Codex collaboration evidence,
  including participants, relationships, tasks, messages, lifecycle events, tools,
  outputs, and provider-specific completeness.
- `trace-model`: Add the canonical team-run, agent, task, edge, message, activity,
  artifact, evidence, metrics, and comparison types.
- `storage`: Persist team metadata and slim activity/graph indexes separately from large
  message, tool-result, and artifact bodies; support incremental differential upserts
  and bounded team queries.
- `realtime`: Coalesce team-run changes and send affected team/agent/task identifiers so
  the frontend can patch locally without full-run or per-agent refetches.
- `frontend`: Expand the shell with a Teams view and Team Compare workflow, including
  topology, task, timeline, communication, evidence, and drill-down surfaces.
- `metrics-analysis`: Add team-level scheduling, coordination, quality, cost, and
  collaboration metrics plus guarded comparison and trade-off generation.

## Impact

- **Contracts:** additive changes to `contracts/data-model.md`,
  `contracts/database.md`, `contracts/api.md`, and `contracts/nfr.md`; no existing route
  or response is removed.
- **Backend:** provider-specific team scanners/adapters, schema migration, differential
  writers, graph/timeline/detail queries, comparison service, and coalesced SSE payloads.
- **Frontend:** one new top-level Teams view plus a compare mode; existing Session and
  Trajectory views remain the event-level drill-down.
- **Data:** existing single-agent sessions remain valid and are not retroactively called
  teams. Legacy merge groups may be offered only as explicitly labelled low-confidence
  candidates, never as confirmed team runs.
- **Performance/privacy:** list and graph endpoints return slim metadata only; message,
  tool, raw, and artifact bodies stay on-demand and desensitized. No new runtime
  dependency is required.
- **External basis:** Huawei Cloud CodeArts documentation updated 2026-08-14 describes
  Leader orchestration, persistent Teammate contexts, bidirectional communication,
  shared task lists, dynamic membership, task artifacts, skills/MCP visibility, and
  final Leader integration. The three-level Codex shape is treated as a topology to
  detect from evidence, not assumed for every provider.
