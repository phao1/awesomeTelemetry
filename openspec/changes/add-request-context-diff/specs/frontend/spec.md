## ADDED Requirements

### Requirement: On-demand Context Diff tab
The Proxy request detail drawer SHALL add a `Context Diff` tab. Opening ordinary Request, Response, Headers, or Timing tabs SHALL NOT fetch or compute a diff; the first Context Diff activation SHALL issue exactly one context-diff request and cache the result for the selected target/base pair.

#### Scenario: Drawer opens on Request tab
- **WHEN** a user opens a proxy request detail drawer
- **THEN** the existing request detail is shown
- **AND** no context-diff endpoint is called

#### Scenario: Context Diff first activation
- **WHEN** the user activates Context Diff for the first time
- **THEN** the UI requests automatic predecessor comparison once
- **AND** displays a loading state until it resolves

#### Scenario: Returning to cached pair
- **WHEN** the user leaves and returns to Context Diff without changing target or base
- **THEN** the cached result renders without another request

### Requirement: Evidence-first diff summary
The Context Diff tab SHALL present pairing confidence and warnings before the change summary, followed by base/target identity, total context growth, token delta availability, compaction indicators, and category counts for System, Messages, Tools, and Parameters. Unknown values SHALL render `—`, not zero.

#### Scenario: Capture-group pairing
- **WHEN** the automatic result uses capture-group confidence
- **THEN** the UI states that the pair came from one proxy run but is not a proven agent session
- **AND** does not label the capture group as a session ID

#### Scenario: Exact pairing
- **WHEN** the automatic result uses exact parsed-session confidence
- **THEN** the UI labels the pair as the nearest request in the same parsed session

#### Scenario: Token delta unavailable
- **WHEN** captured input-token evidence is missing for either side
- **THEN** token delta renders `—` with the returned reason
- **AND** character growth remains visible

### Requirement: Navigable structured changes
The UI SHALL render category filters, added/removed/modified entries, and an unchanged summary count. Changed rows and the unchanged summary SHALL use text/icon labels in addition to color. Unchanged items SHALL NOT be repeated as response rows. Modified bounded text SHALL show inline segments; truncated entries SHALL show their lengths, hashes, excerpts, and truncation explanation.

#### Scenario: Modified tool schema
- **WHEN** the response contains one modified tool schema
- **THEN** selecting Tools reveals the tool name, changed paths, and before/after evidence
- **AND** a user can identify the changed parameter without opening raw JSON

#### Scenario: Large truncated change
- **WHEN** a change entry has `truncated=true`
- **THEN** the UI labels the evidence as partial
- **AND** provides actions to open the existing base and target request details

### Requirement: Manual base selection
When automatic pairing is unavailable or the user chooses a different baseline, the UI SHALL provide a searchable picker over compatible loaded proxy-list metadata and SHALL allow entering a known request ID. The selected base SHALL remain explicit and SHALL NOT silently replace the automatic baseline.

#### Scenario: Automatic pairing unavailable
- **WHEN** the endpoint returns `CONTEXT_DIFF_UNAVAILABLE`
- **THEN** the UI shows an empty guidance state with a base-request picker
- **AND** does not show a zero-change summary

#### Scenario: User chooses manual base
- **WHEN** a user selects another request as base
- **THEN** the UI requests `base=<id>`
- **AND** displays manual confidence and all returned mismatch warnings

### Requirement: Four states and recoverability
The Context Diff tab SHALL have distinct loading, success, unavailable/empty, and error states. Errors SHALL show stable code, copyable message, and retry; unsupported input SHALL explain the reason and leave ordinary request inspection usable.

#### Scenario: Backend unreachable
- **WHEN** the context-diff request fails because the backend is unreachable
- **THEN** an error state appears within 5 seconds with retry
- **AND** the rest of the Proxy drawer remains usable

#### Scenario: Unsupported target format
- **WHEN** the endpoint returns `CONTEXT_DIFF_UNSUPPORTED`
- **THEN** the UI shows the returned normalization reason
- **AND** does not retry automatically or poll

### Requirement: Dense, local, bilingual presentation
The diff UI SHALL use existing design-system atoms, remain inside the right-side Proxy drawer, support keyboard navigation and long-text A-/A+/R controls, and add all copy to both Chinese and English dictionaries. It SHALL NOT add a new top-level view, router, or runtime dependency.

#### Scenario: Keyboard-only review
- **WHEN** focus enters Context Diff
- **THEN** a keyboard user can switch categories, expand entries, choose a base, retry, and open source requests
- **AND** focus indicators remain visible

#### Scenario: Locale switch
- **WHEN** the user switches between Chinese and English
- **THEN** all Context Diff labels, warnings, empty states, and errors use the selected locale
- **AND** backend error codes remain stable
