## ADDED Requirements

### Requirement: Reasoning and compaction event kinds

`TraceKind` SHALL include `reasoning` for model thinking emitted separately from the
user-visible reply, and `compact` for client-side context compaction or auto-summary.
These are the only two members added; the enum remains closed thereafter.

#### Scenario: Reasoning is distinguishable
- **WHEN** a source emits model thinking as its own record
- **THEN** the adapter emits an event of kind `reasoning`
- **AND** it is not merged into the assistant reply event

#### Scenario: Compaction is distinguishable
- **WHEN** a source records a context compaction or auto-summary
- **THEN** the adapter emits an event of kind `compact`
- **AND** it is not left in the unknown-type fallback

#### Scenario: Exhaustive handling
- **WHEN** the enum is extended
- **THEN** every exhaustive branch over `TraceKind` handles both new members explicitly
- **AND** a catch-all branch SHALL NOT be introduced to suppress the compiler

### Requirement: Turn identity is an adapter responsibility

The event contract SHALL carry `turnKey: string | null`. Events produced by one model
inference and the tool activity it triggered SHALL share one key. The adapter supplies
the key because only the adapter knows the source format.

#### Scenario: Shared key within a decision cycle
- **WHEN** one inference requests tools and receives their results
- **THEN** the inference event, any reasoning events, the tool events, and their results all carry the same key

#### Scenario: Opaque key
- **WHEN** a consumer reads a turn key
- **THEN** it uses the key only for grouping and equality
- **AND** it SHALL NOT parse the key, sort by it, or derive a turn index from it

#### Scenario: Stability across rescans
- **WHEN** unchanged source data is scanned twice
- **THEN** the same events receive the same turn keys

#### Scenario: Session scoping
- **WHEN** two sessions are scanned
- **THEN** no turn key appears in both
- **AND** an adapter whose source identifiers are not globally unique prefixes them with a session-scoped value

#### Scenario: No boundary signal in the source
- **GIVEN** a source format that carries no decision-cycle marker
- **WHEN** its adapter runs
- **THEN** every event receives `null`
- **AND** the adapter SHALL NOT synthesise a key from timestamp proximity, event count, or any other heuristic

### Requirement: Turn key provenance declaration

Each adapter SHALL declare how it produced turn keys, using the closed set
`native_boundary`, `stream_structure`, `message_identity`, `unavailable`.

`native_boundary` means the source format labels a cycle outright. `stream_structure`
means the boundary was derived from the shape of the source's own item stream.
`message_identity` means events were grouped by the source's message identifier.
`unavailable` means no signal exists and keys are null.

#### Scenario: Declaration accompanies the record
- **WHEN** an adapter produces a trace record
- **THEN** the record declares its turn-key provenance alongside its existing token semantics

#### Scenario: Derived boundaries are not presented as labelled
- **GIVEN** an adapter that derived cycles from the shape of the source item stream
- **WHEN** it declares provenance
- **THEN** it declares `stream_structure`, not `native_boundary`
- **AND** consumers describing the segmentation SHALL NOT imply the source labelled the boundary

#### Scenario: Consumers read the declaration
- **WHEN** a consumer needs to describe how turns were determined
- **THEN** it reads the declared provenance
- **AND** it SHALL NOT infer confidence from whether keys happen to be non-null
