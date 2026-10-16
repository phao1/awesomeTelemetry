## Purpose

Make a multi-agent team run independently observable and comparable by reconstructing
its topology, task dependencies, communication, per-agent execution, outputs, and
coordination quality from explicit evidence without inventing unavailable facts.

## ADDED Requirements

### Requirement: Team run is a first-class observable unit

The system SHALL represent a team run independently from an individual session. A team
run MUST have one stable run identity, one declared provider, one root goal when present,
one lifecycle, and links to every known participant session. A confirmed team run MUST
contain at least two distinct agent instances or explicit provider evidence that a team
was created; ordinary single-agent sessions MUST NOT be silently promoted to teams.

Each agent instance SHALL retain its provider-native identity, display name, role, model
when known, lifecycle state, first/last activity time, and owning session links. Repeated
roles MUST remain separate agent instances.

#### Scenario: Dynamic members with the same role
- **WHEN** one leader creates two developer teammates from the same role
- **THEN** the run contains two distinct agent instances with their own activity and task history
- **AND** the role is a label, not the agent identity

#### Scenario: Ordinary session is not a team
- **WHEN** a single session has no explicit team marker and no agent relationship evidence
- **THEN** it remains a single-agent session
- **AND** it does not appear as a confirmed team run

#### Scenario: Candidate from legacy grouping
- **WHEN** only a legacy merge group or naming heuristic suggests multiple agents
- **THEN** the system MAY expose a candidate run labelled `inferred`
- **AND** it MUST NOT label the candidate as confirmed or use it in a default comparison

### Requirement: Topology preserves the provider's real structure

The system SHALL model agent-to-agent relationships as a directed graph with explicit
edge type, source, confidence, and valid time. It MUST support creation/supervision edges,
coordination edges, and peer collaboration without forcing every provider into one tree.

For presentation, the system SHALL classify the observed structure as exactly one of:
`two_level`, `three_level`, `deep_tree`, `peer_graph`, `hybrid`, or `unknown`.

- `two_level`: one root plus direct children, with exactly two occupied levels.
- `three_level`: one root, at least one middle collaborative agent, and at least one leaf,
  with exactly three occupied levels.
- `deep_tree`: a single-parent rooted tree with more than three occupied levels.
- `peer_graph`: no authoritative supervisor tree, but peer collaboration edges exist.
- `hybrid`: a supervisor tree exists and also contains cross-tree, multi-parent, or peer
  edges that materially affect execution.
- `unknown`: evidence cannot determine a safe classification.

Depth SHALL be counted by occupied levels with the root as level 1. The label
“Orchestrator → Collaborative Agents → Leaf Agents” SHALL appear only for a confirmed
three-level topology.

#### Scenario: Codex-shaped three-level team
- **WHEN** evidence shows one orchestrator creating collaborative agents and those agents creating leaf agents
- **THEN** the topology is `three_level`
- **AND** each node and creation edge links to its supporting evidence

#### Scenario: Leader and teammates only
- **WHEN** one Team Leader directly owns every teammate and no teammate creates a child
- **THEN** the topology is `two_level`
- **AND** the UI does not invent a collaborative middle layer

#### Scenario: Direct teammate collaboration
- **WHEN** two teammates under the same leader exchange direct coordination messages
- **THEN** the supervisor tree remains visible
- **AND** the topology is `hybrid` when those peer edges materially participate in task flow

#### Scenario: Conflicting parents
- **WHEN** two sources name different parents for the same agent and neither outranks the other
- **THEN** the topology classification is `unknown` or `hybrid` as warranted by explicit edges
- **AND** the conflict is visible rather than arbitrarily resolved

### Requirement: Every reconstructed fact carries provenance and completeness

Every team run, participant, relationship, task, message, activity, round, and artifact
SHALL carry an evidence source and confidence: `native`, `correlated`, `inferred`, or
`unavailable`. Native provider identifiers and sequences SHALL be preserved verbatim.

The run SHALL report independent completeness for topology, tasks, communication,
timing, tools, outputs, tokens, cost, and verification. Missing evidence MUST produce
`null`/unavailable results, never zero, an empty success, or a fabricated event.

#### Scenario: Messages are unavailable
- **WHEN** a provider exposes task assignment and completion but no inter-agent messages
- **THEN** task completeness may be complete while communication completeness is unavailable
- **AND** message count, direct-communication ratio, and handoff latency render unavailable rather than zero

#### Scenario: Correlation by stable identifiers
- **WHEN** a task record and an agent session share an explicit provider task identifier
- **THEN** their association is `correlated`
- **AND** the evidence record identifies both source locations

#### Scenario: Heuristic correlation only
- **WHEN** association depends only on overlapping time and similar titles
- **THEN** confidence is `inferred`
- **AND** the default view provides a control to exclude inferred evidence

### Requirement: Task List is represented as a versioned DAG

The system SHALL represent the team Task List as tasks plus directed dependency edges.
Each task SHALL preserve owner history, status history, priority when present, creation,
start, finish, cancellation, failure, retry, and result links. Assignment and status
changes MUST be events, not overwritten final fields only.

The observed task graph SHALL remain truthful even when it contains a missing dependency,
a cycle, an unassigned task, concurrent owners, or a task created during execution. Such
conditions SHALL be reported as anomalies and MUST NOT be silently repaired.

#### Scenario: Parallel tasks after contract freeze
- **WHEN** three tasks depend on one contract task and then start concurrently
- **THEN** the graph shows all three dependency edges and overlapping execution intervals
- **AND** the contract task appears on their common upstream path

#### Scenario: Reassignment after failure
- **WHEN** a failed teammate's task is reassigned to a replacement agent
- **THEN** both assignments and the failure/recovery transition remain in history
- **AND** only the active assignment owns subsequent work

#### Scenario: Task cycle in source data
- **WHEN** observed dependencies contain a cycle
- **THEN** the cycle is displayed and flagged
- **AND** critical-path metrics for the affected component are unavailable

### Requirement: Communication is a directed, correlated event stream

The system SHALL record inter-agent communication with sender, one or more recipients,
time, direction, delivery mode (`direct`, `leader_mediated`, `broadcast`, or `unknown`),
category, related task, reply/correlation identifier when present, and body availability.

Categories SHALL distinguish at least assignment, coordination, question, answer,
handoff, status, blocker, review, correction, result, and system. Sending and receiving
MUST remain separate lifecycle evidence when the provider exposes both. The system SHALL
NOT infer a reply or causal link from time adjacency alone.

#### Scenario: Backend notifies frontend directly
- **WHEN** one teammate sends an API change directly to another teammate
- **THEN** the communication graph contains a direct edge between them
- **AND** the message links to the affected task when the source provides that link

#### Scenario: Leader-mediated exchange
- **WHEN** a teammate reports to the leader and the leader separately forwards the information
- **THEN** two leader-mediated message events are retained
- **AND** the system does not collapse them into a fictitious peer message

#### Scenario: Request and response
- **WHEN** native correlation identifiers connect a question and answer
- **THEN** round-trip latency is measured from those timestamps
- **AND** without correlation identifiers the two messages remain unpaired

### Requirement: Unified execution ledger explains every agent over time

The system SHALL expose a time-ordered, filterable ledger containing agent lifecycle,
task lifecycle, model round, message, tool call/result, artifact, verification, error,
retry, recovery, and handoff activities. Every activity SHALL identify its agent, related
task when known, start/end or point time, status, source order, and evidence.

Ordering SHALL prefer provider-native sequence within one source and timestamps across
sources. Equal or conflicting timestamps SHALL retain a deterministic source order and
an ambiguity marker; they MUST NOT be presented as proven causality.

#### Scenario: What agent A did in round 5
- **WHEN** the user selects agent A and round 5
- **THEN** the system shows its input/context reference, reasoning availability, messages sent/received, tools invoked, tool results, state changes, outputs, errors, and verification evidence in source order
- **AND** unavailable sections are named explicitly

#### Scenario: Tool body remains on demand
- **WHEN** a ledger row first renders
- **THEN** it shows only slim tool metadata
- **AND** arguments, results, raw payloads, and large artifact bodies load only after explicit expansion

#### Scenario: Ambiguous cross-source ordering
- **WHEN** two activities from different clocks have indistinguishable timestamps and no shared sequence
- **THEN** both remain visible with an ambiguous-order marker
- **AND** neither is claimed to cause the other

### Requirement: Per-agent rounds retain native boundaries and provenance

Each agent's work SHALL be grouped into rounds using the provider's native round or turn
identifier when present. If absent, the system MAY correlate an existing session turn to
the team agent, but SHALL disclose the segmentation source. Rounds MUST NOT be split by
arbitrary event count or idle-time thresholds.

Each round SHALL aggregate wall-clock duration, active duration when measurable, tokens,
cost, tool count, message count, task links, status, and outputs. Parallel child-agent
activity MUST remain separate from the parent's active duration and SHALL be visible as
overlap rather than double-counted parent work.

#### Scenario: Native teammate round
- **WHEN** the provider supplies an agent-local round identifier
- **THEN** all activities sharing it appear in one round with native provenance

#### Scenario: Session-turn fallback
- **WHEN** no team-round identifier exists but the agent has a linked session trajectory
- **THEN** the existing derived turn model may provide round boundaries
- **AND** the round criteria line names the trajectory segmentation source

#### Scenario: No safe round boundary
- **WHEN** neither native rounds nor a linked session turn model exist
- **THEN** the ledger remains event-based
- **AND** per-round metrics are unavailable rather than created from a time-gap heuristic

### Requirement: Lifecycle, failure, recovery, and dynamic membership remain visible

The system SHALL preserve agent spawn, ready, busy, blocked, idle, failed, replaced,
cancelled, and completed transitions when observable. Late-created and early-terminated
members SHALL appear only during their actual lifetimes. Replacement MUST create a new
agent identity and link it to the failed agent; it MUST NOT rewrite history.

#### Scenario: Automatic failure replacement
- **WHEN** a leader replaces a failed member and reassigns its task
- **THEN** the timeline shows failure, replacement creation, reassignment, and resumed execution
- **AND** recovery latency is measured only when every endpoint time is available

#### Scenario: Agent joins midway
- **WHEN** a reviewer is created after builders finish
- **THEN** its swimlane begins at creation time
- **AND** it is absent from earlier concurrency counts

### Requirement: Scheduling analysis separates work, wait, and critical path

The system SHALL compute team wall-clock duration, agent active time, observable wait or
blocked time, total work, maximum concurrency, average concurrency, task critical path,
critical-path share, serial-work estimate, and parallelism efficiency when the required
evidence is complete.

`total work` SHALL sum non-overlapping active intervals per agent. `serial-work estimate`
SHALL equal the sum of task active durations and SHALL be labelled an estimate. Critical
path SHALL follow the task DAG using measured task durations; it SHALL be unavailable for
cyclic or materially incomplete graphs. The system MUST NOT describe wall-clock savings
as caused by the team without a comparable baseline.

#### Scenario: Two builders overlap
- **WHEN** two agents work concurrently for ten measured minutes
- **THEN** team wall-clock includes the ten-minute interval once
- **AND** total work includes up to twenty agent-minutes

#### Scenario: Incomplete timing
- **WHEN** one critical task has no start time
- **THEN** critical path and parallelism efficiency are unavailable
- **AND** other independently measurable counts remain visible

### Requirement: Outputs and verification are attributable

Artifacts SHALL link to producing agents, tasks, creation/update events, acceptance state,
and verification evidence when present. File names and content hashes MAY identify local
artifacts, but bodies SHALL remain on demand. A task marked completed SHALL NOT be treated
as verified unless separate verification evidence exists.

#### Scenario: Completed but unverified task
- **WHEN** a builder marks a task completed and no test, review, acceptance, or leader verification follows
- **THEN** completion is true and verification is unavailable or false according to evidence
- **AND** the quality summary does not call the task verified

#### Scenario: Leader integrates final result
- **WHEN** the leader consumes child outputs, runs validation, and publishes a final summary
- **THEN** those are separate attributable activities
- **AND** the final artifact links to both upstream artifacts and verification evidence

### Requirement: Two-team comparison requires a declared comparison basis

The system SHALL compare exactly two team runs only after evaluating workload
comparability. The basis SHALL include goal/acceptance-criteria identity when available,
project/repository identity, revision or starting state, configured model/team template,
environment, and evidence completeness. The result SHALL be `matched`,
`partially_matched`, `unmatched`, or `unknown`, with reasons.

The user MAY explicitly declare two runs comparable, but the report SHALL retain detected
differences. `unmatched` or `unknown` runs MAY be explored side by side; they MUST NOT
receive a winner or causal efficiency claim.

#### Scenario: Same task and starting revision
- **WHEN** two runs share goal, acceptance criteria, repository, starting revision, and sufficient evidence
- **THEN** the basis is `matched`
- **AND** normalized deltas are enabled

#### Scenario: Different tasks
- **WHEN** the runs implement materially different goals
- **THEN** the basis is `unmatched`
- **AND** the report shows descriptive metrics only and no winner

#### Scenario: User override
- **WHEN** the user manually declares two partially matched runs comparable
- **THEN** comparative metrics are enabled with a persistent manual-basis marker
- **AND** detected model, revision, environment, and completeness differences remain visible

### Requirement: Comparison reports five dimensions without hiding trade-offs

For comparable runs, the system SHALL report Speed, Accuracy, Stability, Cost, and
Collaboration separately. It SHALL provide raw values, absolute delta, relative delta
when the denominator is valid, criteria text, completeness, and linked evidence.

- Speed: wall-clock, critical path, serial-work estimate, time-to-first-delegation,
  concurrency, wait, and handoff latency.
- Accuracy: task completion, acceptance-criteria coverage, verification coverage,
  accepted artifacts, review findings, and rework after review.
- Stability: failures, retries, replacements, blocked/orphan tasks, task-DAG anomalies,
  recovery latency, and unresolved errors.
- Cost: input/output/reasoning/cache tokens, cost, agent/task distribution, and observable
  coordination overhead.
- Collaboration: direct communication, leader-mediated share, response latency, task
  balance, duplicated work, bottleneck concentration, cross-agent review, and handoffs.

No single weighted score SHALL ship by default. A prose “strengths / weaknesses” summary
MUST be generated deterministically from metric deltas and evidence rules, not by an LLM,
and MUST name data gaps that could reverse the conclusion.

#### Scenario: Faster but more expensive
- **WHEN** team A has lower wall-clock time and team B has lower cost with comparable quality
- **THEN** the report states both trade-offs
- **AND** it does not collapse them into one winner

#### Scenario: Missing communication in one run
- **WHEN** team A has complete messages and team B has unavailable messages
- **THEN** direct communication and leader-bottleneck comparison are unavailable
- **AND** speed, cost, or quality metrics with complete evidence may still be compared

#### Scenario: Zero denominator
- **WHEN** a relative delta denominator is zero or unavailable
- **THEN** relative delta is unavailable
- **AND** the report never displays infinity or substitutes zero

### Requirement: Team evidence follows tiered disclosure and privacy rules

Team list, topology, DAG, timeline, and comparison endpoints SHALL omit prompt bodies,
message bodies, reasoning bodies, tool arguments/results, raw provider records, and full
artifact contents. Those bodies SHALL load only from explicit single-item drill-down
requests and SHALL pass through the existing desensitization policy before persistence or
response.

Comparison and aggregation responses SHALL contain only identifiers, counts, durations,
token/cost values, hashes, availability, and bounded excerpts explicitly allowed by the
contract. A missing body MUST NOT prevent slim metadata from being useful.

#### Scenario: Open a team run
- **WHEN** the user opens a team run with thousands of activities
- **THEN** the initial response contains slim graph and activity metadata only
- **AND** it contains none of the prohibited body fields

#### Scenario: Expand one message
- **WHEN** the user expands one communication event
- **THEN** at most one detail request returns its desensitized body and availability
- **AND** reopening it uses the bounded detail cache

### Requirement: Team surfaces link to existing session trajectories

Every participant with a linked session SHALL provide navigation to the existing session
trajectory. Team activities SHALL reference existing event or turn identities when the
mapping is explicit; the team feature SHALL NOT duplicate, rewrite, or renumber session
events.

#### Scenario: Drill into a tool call
- **WHEN** a team ledger activity maps to an existing session event
- **THEN** the user can open that session and event/turn in the trajectory surface
- **AND** both surfaces display the same native event identity and evidence source

#### Scenario: Team-only activity
- **WHEN** a task assignment exists only in a team log and has no session event
- **THEN** it remains visible in the team ledger
- **AND** the UI states that no session-level drill-down is available
