## ADDED Requirements

### Requirement: REQ-016: Team scheduling and coordination metrics

Metrics analysis SHALL compute the team metrics defined by the team-observability
capability using explicit interval, graph, communication, task, token, cost, artifact,
and verification evidence. Every metric SHALL carry criteria, availability,
completeness, numerator/denominator where meaningful, and supporting entity ids.

Overlapping intervals for one agent SHALL be unioned before active time is summed.
Overlaps across different agents SHALL contribute to total work and concurrency without
being double-counted in team wall-clock. Estimated and measured values MUST remain
separate.

#### Scenario: Agent has overlapping tool activities
- **WHEN** one agent has two overlapping measured activities
- **THEN** its active time uses the interval union
- **AND** does not sum the overlap twice

#### Scenario: Parallel agents
- **WHEN** two different agents are active over the same interval
- **THEN** concurrency counts both agents
- **AND** team wall-clock counts the interval once

#### Scenario: Missing endpoints
- **WHEN** a metric requires a missing start, finish, correlation, token, or cost value
- **THEN** that metric is unavailable or partial according to its contract
- **AND** independently supported metrics remain available

### Requirement: REQ-017: Critical path and bottleneck analysis

Critical path SHALL be computed only on an acyclic, sufficiently complete task DAG using
task durations and dependencies. The analysis SHALL identify critical tasks, critical
agents, leader concentration, queue/wait intervals, stalled handoffs, and unowned or
blocked tasks. It SHALL distinguish measured facts from heuristics.

#### Scenario: Acyclic complete DAG
- **WHEN** every task has dependencies and measured start/finish times
- **THEN** the exact critical path and duration are returned with task ids

#### Scenario: Cycle or missing critical duration
- **WHEN** the task graph is cyclic or a required duration is missing
- **THEN** exact critical path is unavailable
- **AND** the anomaly list names the blocker

#### Scenario: Leader bottleneck
- **WHEN** most task transitions require leader mediation and leader wait lies on the critical path
- **THEN** leader concentration and mediated-wait evidence are reported
- **AND** the report does not claim causation beyond the observed path

### Requirement: REQ-018: Team comparison arithmetic and guardrails

Comparison SHALL operate only on the canonical comparison basis and metric contracts.
Absolute delta SHALL be right minus left unless the API explicitly labels a different
direction. Relative delta SHALL use the left value as denominator only when finite and
non-zero. Directionality (“higher is better”, “lower is better”, or “descriptive”) SHALL
be declared per metric.

No overall score or winner SHALL be computed by default. Strengths and weaknesses SHALL
be selected by deterministic rules over material deltas, completeness, and direction;
the output SHALL cite the metric ids and caveats that produced each sentence.

#### Scenario: Comparable complete runs
- **WHEN** two matched runs have complete values for one metric
- **THEN** raw values, absolute delta, relative delta, and direction are returned

#### Scenario: Incomparable runs
- **WHEN** comparison basis is unmatched or unknown
- **THEN** descriptive side-by-side values may be returned
- **AND** normalized verdicts, winner language, and causal claims are absent

#### Scenario: Material trade-off
- **WHEN** one run improves speed but worsens verified quality or cost beyond configured materiality rules
- **THEN** both appear in strengths/weaknesses
- **AND** neither is hidden by an aggregate score

### Requirement: REQ-019: Team aggregation consistency

Server-side team aggregates, per-run detail calculations, and comparison values SHALL
agree on identical fixtures within the contract's numeric tolerance. Cached metrics MUST
carry a calculation version and be invalidated when algorithms or evidence semantics
change.

#### Scenario: Server and detail consistency
- **WHEN** a fixed team fixture is aggregated by the server and calculated from its full ledger
- **THEN** wall-clock, active time, task counts, communication counts, tokens, cost, and verification values agree within tolerance

#### Scenario: Algorithm version changes
- **WHEN** critical-path or collaboration semantics change
- **THEN** the calculation version increments
- **AND** stale persisted metrics are recomputed before comparison
