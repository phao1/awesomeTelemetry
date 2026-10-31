## ADDED Requirements

### Requirement: REQ-018: Team graph and ledger persistence

Storage SHALL persist team runs, agents, relationships, tasks, dependencies, assignments,
communications, activities, rounds, artifacts, evidence references, completeness, and
team metrics in normalized tables with foreign keys and explicit indexes for run/time,
agent/time, task/time, sender/time, recipient/time, and graph membership queries.

Large message, tool, raw, and artifact bodies SHALL be kept outside slim graph/activity
rows. Schema migration SHALL be additive, idempotent, preserve every existing session and
annotation row, and refuse newer database versions.

#### Scenario: Existing database upgrade
- **WHEN** a current database starts under the new schema
- **THEN** all team tables and indexes are created once
- **AND** existing sessions, events, metrics, prompts, and annotations remain unchanged

#### Scenario: Cascade team deletion
- **WHEN** a team run is deleted through its explicit delete workflow
- **THEN** its team-owned graph, ledger, detail, and metrics rows are removed
- **AND** linked session traces remain unless separately deleted

#### Scenario: Slim row inspection
- **WHEN** team graph and ledger columns are inspected
- **THEN** none contains raw, prompt, reasoning, message, tool-result, or artifact body text

### Requirement: REQ-019: Differential team upsert and source reconciliation

Team ingestion SHALL differentially upsert by stable canonical identity inside one
transaction: insert new entities/events, update changed metadata, and delete only stale
derived rows proven absent from a complete source snapshot. An incomplete or tail-only
scan MUST NOT delete prior facts merely because they were not in the current page.

Prepared statements SHALL be cached outside loops. Every query SHALL list columns
explicitly and convert undefined to null.

#### Scenario: Append one message
- **WHEN** an unchanged run gains one communication record
- **THEN** the write path inserts that record and only the aggregates invalidated by it
- **AND** it does not delete and recreate the run's graph or ledger

#### Scenario: Partial scan after interruption
- **WHEN** ingestion ends before the provider source is complete
- **THEN** prior rows are retained
- **AND** completeness and scan state record the interruption

#### Scenario: No-change rescan
- **WHEN** source fingerprints and parser version are unchanged
- **THEN** team parsing and SQL writes are skipped

### Requirement: REQ-020: Bounded team queries and on-demand detail

Storage SHALL support team-run list, team overview, topology/task graph, paginated
activity ledger, single activity/message/tool/artifact detail, and two-run comparison
inputs with bounded queries. List, graph, and activity queries MUST return slim columns
only. Bodies SHALL be returned only by single-item detail queries.

Team overview and comparison inputs SHALL be aggregated server-side. The number of SQL
statements and HTTP-facing result queries MUST NOT grow with agent, task, or activity row
count.

#### Scenario: Open a large team
- **WHEN** a run contains 100 agents, 1,000 tasks, and 100,000 activities
- **THEN** topology/task metadata and the first activity page are returned without loading bodies
- **AND** activity pagination has a deterministic continuation

#### Scenario: Compare two teams
- **WHEN** comparison data is requested
- **THEN** storage returns bounded aggregates for both runs
- **AND** no loop issues one query per agent, task, or session

#### Scenario: Single message detail
- **WHEN** one message body is requested by canonical id
- **THEN** exactly that body's row is loaded
- **AND** an unknown id returns a typed not-found error

### Requirement: REQ-021: Team query plans and retention behavior

Hot team queries SHALL use composite indexes matching their filters and ordering and MUST
NOT produce temporary B-trees at the supported scale. Team evidence follows the owning
source's retention: deleting or expiring raw source bodies MAY make body detail
unavailable, but SHALL NOT silently erase previously persisted slim provenance and
aggregate facts unless the user deletes the run.

#### Scenario: Query-plan audit
- **WHEN** run/time, agent/time, task/time, and communication-edge queries are explained
- **THEN** each uses the expected composite index
- **AND** none reports `USE TEMP B-TREE`

#### Scenario: Raw body expires
- **WHEN** retention removes an underlying raw body
- **THEN** its slim activity and evidence locator remain
- **AND** detail reports body unavailable instead of returning an empty body
