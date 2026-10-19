## Purpose

Provide a coherent frontend workbench that helps developers discover agent runs, identify meaningful differences and investigate operation-level and team-level evidence without confusing missing data with measured results.

## ADDED Requirements

### Requirement: WB-001 Coherent workspace and discoverable navigation
The interface SHALL provide a consistent product identity, clearly labelled existing views, a visible global search entry, keyboard navigation and readable source/connection states. Existing routes and view functions MUST remain reachable. Appearance SHALL work in both themes and at narrow desktop widths without hiding essential controls.

#### Scenario: Search is visible and functional
- **WHEN** a developer activates global search by pointer or keyboard
- **THEN** the existing lazy command palette opens without fetching every session detail, and the underlying workbench remains intact

### Requirement: WB-002 Investigation-first trace reading
Session discovery, Turn navigation, operation inspection and related evidence SHALL form a readable workflow. Selected input/output/raw data SHALL load only on demand; long sessions SHALL preserve paging and virtualization. Errors and slow-operation evidence SHALL be locatable without manually opening every event.

#### Scenario: Inspect a large run
- **WHEN** a developer selects an operation in a long session
- **THEN** selection is clear, the operation can be located within its Turn, and its requested detail is readable without loading unrelated bodies

### Requirement: WB-003 Honest comparison and agent summaries
Agent summaries and selected run/call comparisons SHALL expose comparison basis, observed deltas, metric definitions and unknown coverage. Verification coverage MUST NOT be called measured answer accuracy. Missing prices, incomplete timings and incomparable measurement domains MUST NOT produce a fabricated winner.

#### Scenario: Incomplete comparison
- **WHEN** the selected runs have different measurement bases or no quality evidence
- **THEN** each side remains readable and the interface explains the limitation beside the comparison instead of filling unknown values with zero

User amendment 2026-10-18 to WB-003: monetary amounts, currency badges, pricing
coverage, money rankings/trends/deltas and money-based conclusions SHALL NOT be
presented in any summary/view or generated analytical HTML report. Preserve
Token components, cache/call observations and non-monetary evidence. Existing
raw originals/explicit raw inspection and downloads MUST NOT be rewritten or
stripped of source amounts. No new price/currency contract field is required.

#### Scenario: Same token usage under different prices
- **WHEN** source records contain different monetary prices or reported fees
- **THEN** the workbench shows token/cache evidence without a money summary,
  money-derived difference or monetary advantage; exact raw evidence is intact

### Requirement: WB-004 Usable capture and administration workflows

Capture setup, start/stop, requests, selected detail, import, advanced capture and settings SHALL have clear primary actions, grouped secondary actions, explicit feedback and actionable loading/empty/error states. Existing permissions, confirmation, cancellation and source-integrity safeguards MUST remain effective.

#### Scenario: Listener without target traffic
- **WHEN** the listener is running but no target evidence has arrived
- **THEN** the interface explains the next connection step and does not claim a fully observed Agent

#### Scenario: Reversible current-list clear
- **WHEN** a developer explicitly clears the current request list
- **THEN** only already-loaded rows are hidden locally, without any request,
  original deletion, historical-count reset or listener change; new requests
  remain observable, stale snapshots/SSE cannot revive hidden IDs, and successful
  explicit refresh or reopening restores saved rows with paging intact
- **AND** failed/cancelled refresh keeps the hidden state and restoration guidance;
  per-request original deletion and Stop retain their independent confirmations

### Requirement: WB-005 Evidence-first Team workspace
The Team surface SHALL make members, tasks, communication and execution evidence navigable as related dimensions. Ordinary agent-step bookkeeping MUST NOT be presented as proof of a subagent. Missing communication SHALL be clearly unavailable rather than an empty successful graph.

#### Scenario: No observed recipient
- **WHEN** retained data lacks direct sender/recipient evidence
- **THEN** the Team view explains the communication gap and preserves available topology/task/tool evidence without inventing message edges

### Requirement: WB-006 Consistent accessible visual and motion system
The workbench SHALL use shared design tokens, coherent type/spacing/control hierarchy, visible focus and understandable state changes. Motion SHALL clarify user-triggered selection, feedback and overlay changes, respect reduced-motion preferences, and avoid layout-property transitions or effects on virtualized rows.

#### Scenario: Reduced motion
- **WHEN** reduced motion is requested
- **THEN** animations and transitions cease while all selection, loading and completion states remain understandable

#### Scenario: Wide collaboration topology
- **WHEN** an existing collaboration graph is wider than its reading region
- **THEN** nodes retain their intrinsic readable size inside a named keyboard-focusable horizontal scroll region, without page-wide overflow or a fit-to-width reduction to unreadable text

### Requirement: WB-007 Verified end-to-end usability
Every existing view and major workflow SHALL be verified through relevant colocated regression tests and rendered browser checks in both themes. Existing API, bundle, CSS, request-volume and virtualization budgets MUST remain binding. Missing or indirect evidence SHALL remain explicitly incomplete in the delivery checklist.

#### Scenario: Broad completion claim
- **WHEN** the frontend refresh is reported complete
- **THEN** the record contains current evidence for sessions, agents, compare, capture/import, advanced capture, Mission, settings and Team workflows, not only screenshots of the shell


### Requirement: WB-008 Evidence-based collaboration stage replay
The workbench SHALL provide step playback, pause, previous/next and progress seek
for retained team evidence, with current actor/task highlights and on-demand
redacted source excerpts. It SHALL distinguish observed control operations from
delivered messages, accepted outputs and final snapshot state. It SHALL scope
CodeArts database activities to explicit run membership, use exact native event
identity links, and leave ordinary work without explicit task references unlinked.

#### Scenario: Two team runs share one source database
- **WHEN** source parts contain two runs with the same task or call identifier
- **THEN** each run contains only its explicitly identified member/root activity and resolves event links within its own session and native scope
- **AND** no time-adjacent or final-owner inference supplies a task identifier

#### Scenario: Replay uncertain or incomplete history
- **WHEN** timestamps, recipients, delivery or result acceptance are missing
- **THEN** undated records remain outside the timed axis, incomplete pages are labelled, and unavailable facts remain unknown
- **AND** historical steps do not copy completed states or ownership from the final snapshot

#### Scenario: Inspect playback on a narrow screen
- **WHEN** the workbench is viewed at 600 CSS pixels
- **THEN** one existing run list can be toggled, playback uses the available width, tabs remain horizontally readable, and source detail remains reachable by scrolling
