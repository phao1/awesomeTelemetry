## ADDED Requirements

### Requirement: Role colour tokens

The token contract SHALL define six message-role colour groups — system, user, assistant,
tool, reasoning, compact — each with foreground, emphasis, and subtle tiers in both
themes, plus a ribbon highlight token. Role hues SHALL reuse existing product hues rather
than introducing a second palette.

#### Scenario: Token set parity
- **WHEN** the light and dark token sets are compared
- **THEN** both define the identical role token key set, differing only in value

#### Scenario: Component usage
- **WHEN** a trajectory component needs a role colour
- **THEN** it reads the role token
- **AND** it SHALL NOT write a hex, rgb, or named colour literal

#### Scenario: Contrast
- **WHEN** role foreground text renders on its own subtle background in either theme
- **THEN** the contrast requirement already stated in the token contract is met

### Requirement: Role identity is never colour alone

Every role marker, turn badge, ribbon legend entry, todo status, and diff row SHALL pair
its colour with an icon or with text.

#### Scenario: Role marker
- **WHEN** a message card header renders
- **THEN** it shows the role icon and the role name alongside the role colour

#### Scenario: Ribbon legend
- **WHEN** the legend renders
- **THEN** each of the six entries shows a swatch, an icon, and the role name

#### Scenario: Todo status
- **WHEN** a todo item renders its status
- **THEN** the status is carried by an icon plus a label, not by a coloured dot alone

#### Scenario: Diff rows
- **WHEN** an edit renderer shows added and removed lines
- **THEN** each line carries its plus or minus sign in addition to its background colour

### Requirement: Selection semantics

Selection SHALL be expressed with the accent group. The danger group SHALL NOT indicate
selection anywhere in the trajectory surface.

#### Scenario: Selected agent node
- **WHEN** an agent node is selected
- **THEN** it uses the accent subtle background with an accent emphasis indicator

#### Scenario: Selected turn
- **WHEN** a turn is selected
- **THEN** it uses the accent subtle background and a left bar, matching the existing selected-row treatment

#### Scenario: Active mode control
- **WHEN** the ribbon mode control shows its active option
- **THEN** the active state uses the accent group, not the danger group
