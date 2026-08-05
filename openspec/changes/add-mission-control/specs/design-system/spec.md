# Design System (delta)

## MODIFIED Requirements

### Requirement: Keyboard & command palette
The shortcut `1`-`5` SHALL become `1`-`6` so the nth-view switch covers the
new mission view.

#### Scenario: six views reachable by number keys
- **GIVEN** the app with all 6 views registered
- **WHEN** the user presses `1` … `6`
- **THEN** the corresponding view activates in order

## ADDED Requirements

### Requirement: Chart type selection & criteria line
Mission widgets SHALL follow the chart-type rule: 占比→DonutChart · 趋势→
StackedAreaChart/line · 时间×类目→HeatmapGrid · 排行→HBarChart · 明细→Table ·
Trace→Gantt. **Every widget MUST carry a `criteria` line** rendered below its
title, taken verbatim from the server-provided `criteria` field; the frontend
MUST NOT write criteria text itself. `available=false` renders EmptyState +
`unavailableReason`.

#### Scenario: criteria is server-owned
- **GIVEN** any Mission widget rendering
- **THEN** the criteria line is exactly the string returned by
  `GET /api/mission` for that widget's `criteria` field
- **AND** the frontend contains no hardcoded Mission criteria sentence
