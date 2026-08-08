## ADDED Requirements

### Requirement: Turn surface replaces the event gantt and inspector

The session detail view SHALL replace its event gantt and its right-rail event inspector
with a turn surface: a statistics bar, a turn ribbon, and a turn list. The session header
card, phase ribbon, and phase tiles SHALL be kept — they answer how the session went,
which the turn list does not.

The turn surface SHALL be arranged as a context rail holding the agent hierarchy and
annotations, beside the turn area. No new top-level view is added.

#### Scenario: Removal is complete
- **WHEN** the change ships
- **THEN** the gantt and inspector components and their tests no longer exist
- **AND** nothing in the tree imports them
- **AND** the gantt's layout hash key is removed

#### Scenario: Opening a session
- **WHEN** a session detail is opened
- **THEN** the view issues its existing slim detail request plus one annotations request
- **AND** it issues no per-turn and no per-message request before the user expands a card

#### Scenario: Context rail
- **WHEN** the rail is rendered
- **THEN** its width is resizable within its clamp and persisted
- **AND** below the minimum window width it collapses without disabling the turn area

#### Scenario: Session scope versus agent scope
- **WHEN** the statistics bar renders
- **THEN** it describes the currently selected agent and names which agent it describes
- **AND** the session header card continues to describe the session
- **AND** a difference between the two figures is presented as scope, not as an error

### Requirement: Turn list and turn cards

Turns SHALL render in index order, collapsed by default, showing index, start time, model,
badges, input, cached and output tokens, duration, and message count. Expanding renders
the turn's messages in event order.

#### Scenario: Collapsed row
- **WHEN** a turn is collapsed
- **THEN** its row height is fixed so virtual scrolling can compute positions
- **AND** any numeric field without a value renders an em dash, never a zero

#### Scenario: Expanding
- **WHEN** the user activates a turn row by mouse or keyboard
- **THEN** it expands in place and renders its message cards
- **AND** the expanded turn is excluded from height virtualisation

#### Scenario: Virtual scrolling threshold
- **GIVEN** more than fifty turns
- **WHEN** the list is scrolled
- **THEN** only visible turns plus a small buffer are mounted and the mounted count stays stable

#### Scenario: Segmentation criteria disclosed
- **WHEN** turns were not segmented from adapter-supplied keys with native-boundary provenance
- **THEN** the statistics bar renders a criteria line naming the rule actually used
- **AND** the frontend SHALL NOT substitute its own wording for that line

#### Scenario: Incomplete model
- **GIVEN** a paginated detail response
- **THEN** a persistent banner names the omitted event count
- **AND** every session-level total renders an em dash rather than a partial sum

### Requirement: Message cards

Each message SHALL render as a card marked with its role using a role token, a role icon,
and the role name. Colour SHALL NOT be the only carrier of the role.

#### Scenario: Assistant card
- **WHEN** an assistant message renders
- **THEN** it shows the role marker, duration, and output tokens
- **AND** reasoning content renders in a section that is collapsed by default and separable from the reply
- **AND** the tool calls issued by that message render as blocks inside the card, in sequence order
- **AND** no prefill or decode figure appears unless the session declares native duration provenance

#### Scenario: Tool result card
- **WHEN** a tool result renders
- **THEN** it is its own card ordered after the assistant card that issued the call
- **AND** its header carries the tool name, the call identifier verbatim, duration, and tokens
- **AND** when the result body is absent the card shows an empty state rather than an empty box

#### Scenario: Call identifier fallback
- **GIVEN** an event identifier that is not call-shaped
- **WHEN** the card header renders
- **THEN** it shows the event sequence instead
- **AND** an identifier is never generated

#### Scenario: Compaction card
- **WHEN** a compaction event renders
- **THEN** it is a single line naming the compaction, with its token delta when available

#### Scenario: View control replaces the inspector
- **WHEN** a card is expanded
- **THEN** it offers a rendered view, a source view, and a raw view
- **AND** the raw view fetches on demand, exactly once per event, and is cached
- **AND** token figures are read from the card header and turn meta row, requiring no separate view

#### Scenario: Body loading
- **WHEN** a card body is expanded for the first time
- **THEN** exactly one single-event request is issued
- **AND** re-expanding issues none
- **AND** loading, empty, error with retry, and success are all implemented

### Requirement: Turn ribbon

A horizontal ribbon of turn segments SHALL render above the turn list, with a time mode
and a token mode.

#### Scenario: Proportional widths
- **WHEN** the ribbon renders
- **THEN** each segment's width is proportional to its turn's share in the active mode, with a floor so no turn is invisible

#### Scenario: Zero total
- **GIVEN** every turn has zero weight in the active mode
- **THEN** all segments render at equal width and no division by zero occurs

#### Scenario: Large sessions
- **GIVEN** more turns than the segment cap
- **THEN** segments are bucketed to the cap, each bucket naming its turn range
- **AND** no turn is silently dropped

#### Scenario: Mode switch
- **WHEN** the mode is switched
- **THEN** widths recompute in one transition with no network request
- **AND** the highlighted turn and the proportional scroll position are preserved

#### Scenario: Two-way highlight
- **WHEN** the turn list scrolls
- **THEN** the ribbon highlights the top-most fully visible turn, updated at most once per animation frame
- **AND** activating a segment scrolls its turn into view and expands it

#### Scenario: Legend and non-visual access
- **WHEN** the legend renders
- **THEN** each of the six roles shows a swatch, an icon, and a name
- **AND** every segment carries an accessible label naming its turn index or range, duration, and token total, and is keyboard-activatable

### Requirement: Agent hierarchy panel

The rail SHALL render the agent tree for the current session's merge group, to a maximum
depth of five, marking the main agent and each sub-agent with its type label and turn
count.

#### Scenario: Loading members
- **WHEN** the group has more than one member
- **THEN** member rows are fetched in one batched request and never per member

#### Scenario: Single agent
- **GIVEN** a session with no sub-agents
- **THEN** one root node renders rather than an empty tree

#### Scenario: Switching agent
- **WHEN** another agent node is selected
- **THEN** the turn area reloads for that agent and the statistics bar names it

#### Scenario: Selection styling
- **WHEN** a node is selected
- **THEN** it uses the accent token plus a text or icon indicator
- **AND** the danger token SHALL NOT indicate selection

#### Scenario: Unknown sub-agent type
- **WHEN** a type cannot be extracted
- **THEN** it renders as unknown with the existing heuristic explanation, and is not guessed from the title

### Requirement: Annotations panel

The rail SHALL let the user manage the session's tags and note.

#### Scenario: Tag lifecycle
- **WHEN** a tag is added or removed
- **THEN** the change persists immediately
- **AND** a rejected value surfaces the server error code without clearing the user's other tags

#### Scenario: Note lifecycle
- **WHEN** the note differs from the persisted value
- **THEN** the save control is enabled and persists only on explicit save, never on keystroke
- **AND** success shows a success notification and disables the control
- **AND** failure shows an error notification carrying the code and leaves it enabled

#### Scenario: Never annotated
- **WHEN** the session has never been annotated
- **THEN** the panel renders empty tags and an empty note without an error state

### Requirement: Session list tags

The session list SHALL show each session's tags and SHALL support filtering by tag with
OR semantics, matching the existing multi-select filters.

#### Scenario: Tag column
- **WHEN** the list renders
- **THEN** each row shows its tags
- **AND** the list still issues exactly one request

#### Scenario: OR filtering
- **WHEN** two tags are selected
- **THEN** sessions carrying either tag are returned

#### Scenario: Free-text entry
- **WHEN** the filter is opened
- **THEN** the candidate tag vocabulary is fetched once
- **AND** a tag may also be typed directly
- **AND** no request is issued per keystroke

#### Scenario: Filter state in the URL
- **WHEN** a tag filter is applied
- **THEN** it appears in the hash and is restored on reload
- **AND** an invalid value is dropped without throwing

### Requirement: Trajectory analysis panel

The statistics bar SHALL offer an analysis panel computed entirely on the client.

#### Scenario: Opening analysis
- **WHEN** the panel is opened
- **THEN** it issues zero network requests
- **AND** it renders an overview, tool usage, top turns by duration, top turns by tokens, a cache-rate trend, and an anomaly list

#### Scenario: Anomalies
- **WHEN** a turn crosses a defined threshold
- **THEN** it appears with its rule, turn index, and detail
- **AND** each entry carries an icon and text, not colour alone

#### Scenario: Incomplete model
- **GIVEN** an incomplete model
- **THEN** the panel renders the incompleteness banner and every total renders an em dash
