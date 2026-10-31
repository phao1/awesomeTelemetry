## ADDED Requirements

### Requirement: REQ-009: Coalesced team-run changes

The event contract SHALL include a coalesced team-run change signal carrying affected run
ids and, when bounded, affected agent ids and task ids. The server SHALL merge changes in
the existing 200ms window. Per-agent, per-task, per-message, and per-activity SSE events
MUST NOT exist.

When the affected-id set exceeds the contract cap, the signal SHALL retain run ids and a
truncation/invalidate-run marker rather than emit unbounded payloads.

#### Scenario: Burst from a running team
- **WHEN** 1,000 activities across 20 agents arrive within one scan burst
- **THEN** the server emits a bounded number of coalesced team-run change events
- **AND** it emits no event per activity or per agent

#### Scenario: Changed ids fit the cap
- **WHEN** three agents and five tasks change within the window
- **THEN** one signal names the run and those affected identifiers
- **AND** the frontend can patch only those entities

#### Scenario: Changed ids exceed the cap
- **WHEN** affected task or agent ids exceed the contract cap
- **THEN** the signal marks the run-level cache invalid
- **AND** the payload remains within the SSE size budget

### Requirement: REQ-010: Team live patching preserves local state

On a team-run change, consumers SHALL patch the team list and currently open run with at
most one batched metadata request each. They MUST NOT refetch every agent session, every
task, every activity page, or the full team history. Expanded detail bodies and the user's
selection/scroll state SHALL remain unless their exact ids were deleted.

#### Scenario: One teammate finishes a task
- **WHEN** a completion signal names one run, one agent, and one task
- **THEN** the open team surface requests one bounded patch
- **AND** preserves the selected agent, selected task, timeline position, and cached bodies

#### Scenario: Disconnected client reconnects
- **WHEN** SSE reconnects after missed team changes
- **THEN** the client invalidates the open run by its current stamp and requests one current snapshot
- **AND** does not replay one request per missed activity
