## ADDED Requirements

### Requirement: Turn-level trajectory analysis

Metrics analysis SHALL define a client-computable trajectory analysis over the derived
turn model. The analysis SHALL be pure arithmetic over data already loaded, SHALL issue
no request, and SHALL NOT call a language model.

Sections: execution overview; tool usage; top turns by duration; top turns by tokens;
per-turn cache-rate trend; anomaly list.

#### Scenario: Tool usage aggregation
- **WHEN** tool usage is computed
- **THEN** member events are grouped by tool name with call count, mean duration, and summed tokens
- **AND** rows are ordered by call count descending, ties broken by tool name ascending

#### Scenario: Top turn lists
- **WHEN** top turns are computed
- **THEN** at most ten turns are returned for each of duration and token total, ordered descending
- **AND** ties are broken by turn index ascending so the output is deterministic

#### Scenario: Cache rate
- **WHEN** a turn's cache rate is computed
- **THEN** it equals cache-read tokens divided by the sum of input and cache-read tokens
- **AND** it is null when that denominator is zero
- **AND** a null rate renders as an em dash, never as zero

#### Scenario: Zero-turn session
- **WHEN** the analysis runs over a session with no turns
- **THEN** every section reports empty rather than failing

### Requirement: Trajectory anomaly rules

The analysis SHALL flag anomalies using fixed thresholds. Thresholds SHALL NOT be tuned
during implementation to make a fixture pass.

| Rule | Condition | Severity |
|---|---|---|
| slow turn | turn duration greater than 30,000 ms | danger |
| high input | turn input tokens greater than 50,000 | attention |
| tool error | a member tool event has error status | danger |
| low cache | the turn's cache rate is non-null and below 0.5 | attention |

#### Scenario: Threshold boundary
- **WHEN** a turn's duration is exactly 30,000 ms
- **THEN** no slow-turn anomaly is raised
- **AND** at 30,001 ms the anomaly is raised

#### Scenario: Unknown cache rate
- **GIVEN** a turn whose cache rate is null
- **THEN** no low-cache anomaly is raised for it

#### Scenario: Anomaly entry shape
- **WHEN** an anomaly is raised
- **THEN** it carries the rule identifier, the turn index, and a detail string
- **AND** the detail string names the measured value and the threshold it crossed

### Requirement: Analysis inherits model completeness

When the derived turn model is incomplete, the analysis SHALL declare itself incomplete
and SHALL NOT present partial aggregates as totals.

#### Scenario: Partial input
- **GIVEN** an incomplete turn model
- **WHEN** the analysis is computed
- **THEN** its result is marked incomplete with the omitted event count
- **AND** consumers render every total as an em dash
