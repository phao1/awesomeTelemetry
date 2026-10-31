## MODIFIED Requirements

### Requirement: REQ-001: Six-view shell

`App.tsx` SHALL provide 7 views: session / team / agent / compare / proxy / frida /
mission. The team view is the only surface that treats a multi-agent run as one unit;
the existing agent view remains a cross-session provider aggregation.

#### Scenario: Team navigation
- **WHEN** the user activates the Team tab
- **THEN** the shell renders the dedicated team-run list and observability surface
- **AND** it does not replace or relabel the existing Agent view

### Requirement: REQ-024: URL state sync

View, selected session or team run, comparison pair, focused agent/task/activity, active
team subview, time range, and filters SHALL be reflected in the URL hash:

```
#/sessions?key=claude-09893f87625581&phase=implement,debug&provider=claude
#/teams?run=team-xxx&panel=timeline&agent=agent-yyy&task=task-zzz
#/teams/compare?left=team-xxx&right=team-yyy
#/agents
#/compare?left=claude-xxx&right=codex-yyy
#/mission?range=7d
```

Refreshing MUST restore the same valid state. Unknown ids or invalid enum values SHALL be
dropped with a visible empty/not-found state rather than crash. No router library SHALL
be added; parsing and serialization remain in the existing hash-state module.

#### Scenario: Share a focused team activity
- **WHEN** the user copies a URL while one agent, task, and activity are focused
- **THEN** opening the URL restores the team run and every valid focus
- **AND** body content is not embedded in the URL

#### Scenario: Deleted run in a saved URL
- **WHEN** a saved URL references a team run that no longer exists
- **THEN** the Teams view shows a not-found state with a return-to-list action
- **AND** the shell remains usable

## ADDED Requirements

### Requirement: REQ-028: Team run explorer

The Teams view SHALL provide a dense run list and one coordinated exploration surface:

1. summary header with provider, goal/title, lifecycle, duration, agents, tasks, tokens,
   cost, verification, topology classification, and evidence completeness;
2. topology view showing supervisor tree plus peer/cross-tree communication edges;
3. task-DAG view showing dependency, ownership, status, critical path, and anomalies;
4. swimlane timeline showing one lane per agent and overlays for tasks, rounds, messages,
   tools, failures, handoffs, and artifacts;
5. execution ledger with agent/task/kind/status/time filters;
6. communication view with directed edges, categories, volumes, latency, and message list;
7. detail inspector for one agent, task, round, activity, message, tool, or artifact;
8. evidence panel naming source, confidence, parser version, completeness, and conflicts.

Selecting an entity in any view SHALL cross-highlight the same agent/task/activity in the
other loaded views without losing scroll/zoom state. Session-linked entities SHALL expose
a jump to the existing trajectory view.

#### Scenario: Inspect a three-level run
- **WHEN** the user opens a confirmed three-level team
- **THEN** the topology visibly separates orchestrator, collaborative agents, and leaves
- **AND** each edge can reveal its evidence
- **AND** peer communication is overlaid without changing parentage

#### Scenario: Inspect agent round
- **WHEN** the user selects one agent and one round in the timeline
- **THEN** the ledger and inspector show that round's tasks, messages, tools, outputs, status, timing, tokens, cost, and verification evidence
- **AND** each unavailable category is explicit

#### Scenario: Task selection cross-filters
- **WHEN** the user selects a task in the DAG
- **THEN** owners and communications highlight in topology
- **AND** relevant intervals highlight in the swimlane
- **AND** the ledger filters to related activities without a new request when data is already loaded

#### Scenario: Cyclic task graph
- **WHEN** a task graph contains a cycle
- **THEN** the cycle is rendered with an anomaly marker
- **AND** critical-path presentation is unavailable with a reason

### Requirement: REQ-029: Team data loading and virtualization

The Teams view SHALL load a paginated run list, one bounded slim run snapshot, and one
paginated activity ledger. It MUST NOT fetch per agent, per task, per message, or per
session on initial open. Body and raw requests occur only for the one selected detail and
are cached in the bounded detail cache.

The run list, ledger, task list, and agent swimlanes SHALL virtualize above their contract
thresholds. Topology/task graphs SHALL use level-of-detail aggregation above their node
caps while preserving totals and providing a filtered expansion path. No fact may be
dropped without an omitted-count indicator.

#### Scenario: Initial team open request budget
- **WHEN** a team run is opened
- **THEN** the view issues one slim snapshot request and at most one first-ledger-page request
- **AND** issues zero per-agent, per-task, per-session, and body requests

#### Scenario: Expand one message and one tool result
- **WHEN** the user expands one message and one tool result
- **THEN** at most one detail request is issued for each
- **AND** re-expanding either issues no request

#### Scenario: Large run
- **WHEN** the run exceeds graph, lane, or ledger display caps
- **THEN** the UI remains interactive using virtualization or level of detail
- **AND** displays total and omitted/aggregated counts

### Requirement: REQ-030: Team timeline semantics

The swimlane SHALL use one shared wall-clock axis. Agent lanes begin at agent creation and
end at termination or last known activity. Task/round/tool intervals use measured time;
point events remain visible with a minimum-width marker. Unknown end time MUST render as
open/unknown, not zero duration.

Overlaps SHALL be shown as concurrency. Waiting, blocked, idle, and unknown gaps MUST use
different labels and visual semantics; absence of activity alone MUST NOT be called idle.
Critical-path emphasis SHALL be a reversible overlay and MUST NOT hide non-critical work.

#### Scenario: Concurrent work
- **WHEN** two agents are active at the same wall-clock time
- **THEN** their intervals align vertically on the same time axis
- **AND** the concurrency summary reflects both

#### Scenario: Unknown gap
- **WHEN** no lifecycle state explains a gap between two observed activities
- **THEN** the gap is labelled unknown
- **AND** it is not counted as observed idle or blocked time

#### Scenario: Agent clock uncertainty
- **WHEN** cross-source timestamps are ambiguous
- **THEN** affected activities carry an uncertainty marker
- **AND** the view does not imply exact before/after causality

### Requirement: REQ-031: Communication explorer

The communication surface SHALL distinguish direct, leader-mediated, broadcast, and
unknown delivery. It SHALL support sender, recipient, task, category, and time filters;
request/reply pairs SHALL show latency only when correlation is proven. Edge thickness or
color MUST be accompanied by numeric/text labels so meaning is not color-only.

Message bodies SHALL be collapsed and on demand. The default graph MUST remain usable
when communication evidence is partial or absent by rendering the topology and an
availability explanation instead of a misleading empty network.

#### Scenario: Direct versus mediated paths
- **WHEN** both peer messages and leader-forwarded messages exist
- **THEN** the graph and summary distinguish their counts and paths
- **AND** no forwarded pair is rewritten as direct communication

#### Scenario: Communication unavailable
- **WHEN** a run has no capturable communication source
- **THEN** the panel shows an unavailable state naming the provider/source gap
- **AND** does not display `0 messages` as a measured fact

### Requirement: REQ-032: Team comparison view

Team Compare SHALL provide searchable left/right team-run selectors, a comparison-basis
banner, aligned topology/task/timeline summaries, and separate Speed, Accuracy,
Stability, Cost, and Collaboration sections. Every metric row SHALL display both raw
values, delta, direction/criteria, completeness, and evidence links.

The first summary SHALL present deterministic strengths, weaknesses, and trade-offs. It
MUST NOT display an overall score or winner by default. When the basis is unmatched or
unknown, verdict language SHALL be disabled while descriptive side-by-side exploration
remains available.

#### Scenario: Matched CodeArts and Codex runs
- **WHEN** the user compares matched runs from different providers
- **THEN** provider-specific topology labels remain visible
- **AND** normalized metrics use the same criteria
- **AND** unsupported dimensions are excluded with reasons rather than treated as zero

#### Scenario: Faster team has more rework
- **WHEN** one run finishes sooner but has more review corrections or failed verification
- **THEN** the summary reports both the speed advantage and quality/stability disadvantage
- **AND** declares no overall winner

#### Scenario: Unmatched pair
- **WHEN** selected runs have an unmatched comparison basis
- **THEN** the basis banner explains the mismatches
- **AND** comparative verdicts and relative efficiency claims are absent

### Requirement: REQ-033: Evidence, states, accessibility, and terminology

Every team panel SHALL implement loading, empty, error with retry, success, partial, and
unavailable states. Inferred nodes/edges/metrics SHALL be visibly distinct and
filterable; conflicts SHALL be actionable from the evidence panel. `null` SHALL render an
em dash with a reason, never zero.

Graph nodes, edges, timeline intervals, and comparison deltas SHALL be keyboard reachable
and have textual accessible names. Color SHALL never be the only carrier of hierarchy,
status, direction, confidence, or comparison result. Chinese and English terminology
SHALL distinguish Team, Agent, Role, Task, To-Do, Round, Message, Tool, Artifact,
Verification, and Evidence consistently.

#### Scenario: Inferred evidence hidden
- **WHEN** the user disables inferred evidence
- **THEN** inferred entities and dependent metrics are removed or marked unavailable
- **AND** native/correlated entities keep stable ids and selections where possible

#### Scenario: Keyboard graph inspection
- **WHEN** a keyboard user focuses topology or task graph
- **THEN** they can traverse nodes, inspect edges, open details, and return focus
- **AND** accessible names include entity, relationship/status, confidence, and time when available

#### Scenario: Partial run
- **WHEN** activity ingestion is incomplete
- **THEN** a persistent partial-data banner names affected dimensions
- **AND** run totals dependent on missing pages render unavailable
