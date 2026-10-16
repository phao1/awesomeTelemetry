## ADDED Requirements

### Requirement: Canonical team trace types

The trace model SHALL define canonical types for team runs, agents, agent relationships,
tasks, task dependencies, assignments, communications, activities, rounds, artifacts,
evidence references, completeness, team metrics, comparison basis, and comparison output.
All adapters, storage, API, analysis, and frontend code MUST adopt the authoritative
definitions in `contracts/data-model.md` verbatim and MUST NOT create parallel shapes.

Team activities SHALL use a separate closed activity-kind vocabulary rather than extend
`TraceKind`; an agent's session events remain valid session trace events and are linked by
identity. Every external timestamp SHALL be ISO 8601 UTC. Every nullable or unavailable
measurement SHALL remain explicit.

#### Scenario: Provider-specific event enters the model
- **WHEN** a provider emits a team event with no canonical activity kind
- **THEN** the adapter maps it to a defined canonical kind or `unknown`
- **AND** preserves the provider-native type in evidence metadata
- **AND** does not extend the union locally

#### Scenario: One activity links to a session event
- **WHEN** a tool activity has an explicit native event identifier
- **THEN** the team activity carries the session/event reference
- **AND** the underlying `TraceEvent` is neither duplicated nor renumbered

#### Scenario: Undefined becomes null before persistence
- **WHEN** an optional provider field is absent
- **THEN** the normalized in-memory type follows the contract's optional/null rule
- **AND** `undefined` is converted to `null` before database writing

### Requirement: Stable identities and versioned evidence

Canonical team identities SHALL be deterministic across rescans of unchanged source
data. A provider-native identifier SHALL be preferred; otherwise the derived identifier
MUST include provider, source path, run identity, entity kind, and native/local identity
so two runs or agents cannot collide.

An evidence reference SHALL identify source kind, source location or opaque locator,
native id/sequence when present, capture time, confidence, and parser version. Evidence
body content MUST NOT be embedded in graph/index types.

#### Scenario: Same role in different runs
- **WHEN** two runs each contain a teammate named `Reviewer`
- **THEN** the agents have different canonical ids
- **AND** rescanning either unchanged run reproduces its prior id

#### Scenario: Parser rule changes
- **WHEN** an inference rule changes between parser versions
- **THEN** recomputed inferred relationships carry the new parser version
- **AND** native provider ids remain unchanged

### Requirement: Independent completeness and metric availability

The canonical model SHALL express completeness independently for topology, task graph,
communication, timing, tools, outputs, tokens, cost, and verification. Metrics SHALL
carry availability and criteria; unknown input MUST propagate to the affected metric
without erasing independently known metrics.

#### Scenario: Tokens known, cost unknown
- **WHEN** token counts exist but the model price is unknown
- **THEN** token completeness and token metrics remain available
- **AND** cost is unavailable rather than zero

#### Scenario: Partial activity page
- **WHEN** a response omits later activities because of pagination
- **THEN** the response declares the omitted count or continuation
- **AND** aggregates derived only from the page are not labelled run totals
