# Frontend (delta)

## MODIFIED Requirements

### Requirement: Six-view shell
`App.tsx` SHALL provide 6 views: session / agent / compare / proxy / frida /
mission.

#### Scenario: keyboard switch to the sixth view
- **GIVEN** the app is running with the keyboard shortcuts installed
- **WHEN** the user presses `6`
- **THEN** the mission view becomes active

## ADDED Requirements

### Requirement: Mission view
The 6th view `mission` SHALL render a single-column `MissionControl` with
A/B/C section chip navigation, a top control bar (range 7d/30d/all + manual
refresh + meta row), and exactly one data request
(`GET /api/mission?range=&dataSource=&tz=`). Every widget renders the
server-provided `criteria` line; `available=false` renders `EmptyState` +
`unavailableReason`. Time bucketing (A4/A7/C3) happens server-side using the
client's `tz` offset. Hot sessions drill down via the existing
`#/sessions?key=` hash route.

#### Scenario: mission request count
- **GIVEN** the user switches to the mission view
- **THEN** the network panel shows exactly 1 request for the view's data
- **AND** no per-session fetch loop exists in the mission components

#### Scenario: pricing gap renders dash
- **GIVEN** sessions whose `cost_source = 'unknown'`
- **WHEN** the cost widgets render
- **THEN** those sessions show `—` and are excluded from the `$/turn`
  numerator and denominator

#### Scenario: no polling refresh
- **GIVEN** the mission view is open
- **THEN** it refreshes via SSE `sessions_changed` stamp invalidation and a
  manual refresh button
- **AND** it never polls on a timer (Tengu's 60s auto-refresh is rejected)
