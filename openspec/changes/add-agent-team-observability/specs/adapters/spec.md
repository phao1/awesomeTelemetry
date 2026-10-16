## ADDED Requirements

### Requirement: REQ-014: Team-run detection and normalization

Adapters SHALL detect team runs only from explicit product records or a documented set of
correlation rules. They SHALL normalize participants, creation/supervision relationships,
roles, tasks and dependencies, assignments, lifecycle, communications, rounds, tool
activity, outputs, artifacts, verification, tokens, and cost when those facts are present.

Every normalized fact SHALL retain provider-native identity, source order, evidence
location, and confidence. Unsupported evidence SHALL produce a declared completeness gap;
adapters MUST NOT synthesize messages, parents, task dependencies, timing, outputs, or
successful completion.

#### Scenario: Explicit provider team marker
- **WHEN** a source record explicitly identifies a run as Agent Team and lists its leader and members
- **THEN** the adapter emits one confirmed team run with native membership evidence

#### Scenario: No team evidence
- **WHEN** a provider session contains tool calls but no team, child-agent, or task-pool evidence
- **THEN** the adapter emits no confirmed team run

#### Scenario: Missing communication source
- **WHEN** a source contains participants and tasks but no message log
- **THEN** the adapter emits the participants and tasks
- **AND** declares communication completeness unavailable

### Requirement: REQ-015: CodeArts Agent Team evidence mapping

The CodeArts adapter SHALL recognize the documented Agent Team concepts without reducing
them to generic subagents: Team Leader, Teammate, Role, Scene, Subagent, Task List, To-Do,
shared-task ownership, bidirectional messages, dynamic membership, recovery/replacement,
tool/skill/MCP use, task artifacts, context usage, and final Leader integration.

The implementation SHALL first inventory real local CodeArts Agent Team logs and records,
freeze a source-to-contract mapping, and fixture every adopted record shape. Product
documentation describes capabilities but SHALL NOT be treated as proof that a particular
local run emitted a given event.

#### Scenario: Two teammates communicate directly
- **WHEN** a real CodeArts record identifies sender and recipient teammates
- **THEN** the adapter emits a direct communication event with native ids
- **AND** does not route it through the leader in the normalized graph

#### Scenario: Shared task is autonomously claimed
- **WHEN** the source distinguishes task creation from teammate claim
- **THEN** both events and their timestamps remain visible
- **AND** assignment is not backdated to task creation

#### Scenario: Documented feature absent from local logs
- **WHEN** documentation says recovery exists but the fixture contains no recovery event
- **THEN** recovery completeness is unavailable for that run
- **AND** no recovery is inferred from a later successful task alone

### Requirement: REQ-016: Codex collaboration evidence mapping

The Codex adapter SHALL normalize orchestrator, collaborative-agent, and leaf-agent
relationships only when their identities and creation chain are present in local session
or collaboration evidence. It SHALL preserve parent/child and peer communication events,
task assignments, agent turns, tool calls/results, status changes, outputs, interruptions,
follow-up work, and final integration when available.

The label Orchestrator → Collaborative Agents → Leaf Agents SHALL be derived from the
observed three-level topology, never from provider name alone.

#### Scenario: Collaborative agent creates a leaf
- **WHEN** a Codex collaboration record links a leaf agent to a non-root parent
- **THEN** both creation edges are emitted with native evidence
- **AND** the resulting topology may classify as three-level

#### Scenario: Root creates every agent directly
- **WHEN** all observed agents have the orchestrator as parent
- **THEN** the adapter emits a two-level tree
- **AND** does not insert a collaborative middle level

#### Scenario: Communication not captured
- **WHEN** agent creation and final results are visible but direct messages are not
- **THEN** topology remains observable
- **AND** communication metrics remain unavailable

### Requirement: REQ-017: Team adapter fixtures and contradiction tests

Each supported team dialect SHALL have minimal, multi-level, direct-communication,
parallel-task, failure/replacement, incomplete-evidence, duplicate-id, out-of-order-time,
and malformed-record fixtures. Tests SHALL assert complete normalized snapshots and
negative guarantees against invented facts.

#### Scenario: Duplicate native identifiers
- **WHEN** two provider records reuse an identifier within one run
- **THEN** canonical ids remain unique using the contract's deterministic suffix rule
- **AND** both original native ids remain visible in evidence

#### Scenario: Malformed team record
- **WHEN** one record cannot be parsed
- **THEN** valid neighboring records still normalize in stable order
- **AND** the run reports a parse gap/error rather than an empty successful team

#### Scenario: Contradictory parent evidence
- **WHEN** fixtures provide two authoritative-looking parents for one agent
- **THEN** both evidence records survive
- **AND** the normalized result exposes the contradiction without selecting one silently
