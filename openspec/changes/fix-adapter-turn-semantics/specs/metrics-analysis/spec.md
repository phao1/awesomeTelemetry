## ADDED Requirements

### Requirement: Phase classification for reasoning and compaction

The phase classifier SHALL handle the two new event kinds explicitly.

#### Scenario: Reasoning inherits its cycle's phase
- **WHEN** a reasoning event is classified
- **THEN** it takes the phase assigned to the inference event of the same decision cycle
- **AND** it does not introduce a phase of its own

#### Scenario: Compaction is context work
- **WHEN** a compaction event is classified
- **THEN** it is assigned the understand phase

#### Scenario: Compaction is excluded from agent-work metrics
- **WHEN** average tool duration and error rate are computed
- **THEN** compaction events are excluded from both numerator and denominator

### Requirement: Metric values move with the reclassification

Repairing event classification changes computed metrics. The change SHALL update expected
values rather than relax assertions, and SHALL prove the two aggregation paths still
agree.

#### Scenario: Expected values are recomputed
- **WHEN** an existing test's expected metric value no longer holds
- **THEN** the expectation is recomputed from the corrected classification
- **AND** the assertion is not loosened, widened, or removed

#### Scenario: Aggregation consistency survives
- **WHEN** server-side aggregation and per-session computation run over the same corrected data
- **THEN** they continue to agree within the existing tolerance
- **AND** a disagreement is fixed in the implementation, never by widening the tolerance

#### Scenario: Movement is recorded
- **WHEN** the change is completed
- **THEN** before-and-after phase distribution, error rate, average tool duration, and tool event count are recorded for one real session per repaired provider
- **AND** the previous performance baseline is annotated as superseded rather than deleted

### Requirement: Token totals are unchanged by the usage-record repair

Removing standalone usage-record events SHALL NOT change any session's token totals.

#### Scenario: Totals before and after
- **GIVEN** a fixture whose expected token totals were computed independently of the adapter
- **WHEN** usage records stop producing standalone events and their usage is attached to the cycle's inference event
- **THEN** the session's aggregated token usage is identical to the previously produced value
