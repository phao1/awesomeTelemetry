# Spec: Design System

> The atomic layer of visuals and interaction. Numeric source:
> `contracts/design-tokens.md` (contract wins on conflict). Source files:
> `src/styles/`, `src/components/ui/`, `src/components/icons/`
>
> This spec describes **how to use** those tokens and components;
> `frontend/spec.md` describes **how the pages are assembled**.

## Purpose

Give Agent Observability a developer-tool-grade visual language: dark first,
information-dense, semantically restrained, zero external dependencies. Fix
the current state — 72 lines of hardcoded CSS, no theming, no icons, no
loading/empty/error states — which "runs but doesn't feel usable".

---

## Requirements

### REQ-001: Single source of tokens

All design tokens SHALL be defined in `src/styles/tokens.css` in the `:root`
and `[data-theme="light"]` blocks, with values aligned item by item to
`contracts/design-tokens.md` §2-§7.

`src/styles.css` (currently 72 lines of hardcoded values) SHALL be split into:

```
src/styles/
├── tokens.css      ← only :root / [data-theme] variable declarations, no selector rules
├── base.css        ← reset, html/body, scrollbars, focus ring, selection
├── layout.css      ← app shell skeleton (header/tabs/rail/main/inspector/statusbar)
└── components.css  ← common component classes (.btn/.badge/.field/.table/...)
```

`src/main.tsx` imports in `tokens → base → layout → components` order; the
order cannot change.

#### Scenario: theme switch without flash
- **GIVEN** the user clicks the theme toggle while in dark mode
- **WHEN** `data-theme` changes from `dark` to `light`
- **THEN** MUST NOT reload the page
- **AND** MUST NOT flash a white frame (token switch completes within the same
  frame)

#### Scenario: no wrong theme on first paint
- **GIVEN** the user last chose `light` and now refreshes the page
- **THEN** the **inline synchronous** script in `index.html` MUST read
  localStorage and set `data-theme` before CSS is applied
- **AND** MUST NOT render dark first and then jump to light

---

### REQ-002: No literal style values

In `src/**/*.css` and component inline `style`, outside `tokens.css`, MUST NOT
appear:

- literal colors (`#rgb` / `#rrggbb` / `rgb()` / `hsl()`)
- literal spacing / font sizes (except unambiguous values like `0`, `0px`,
  `1px` borders, `100%`, `999px`)

Only `var(--*)` and `calc()` built from tokens are allowed.

> **Why**: the current 72 lines of CSS scatter 30+ hardcoded hex values, none
> of which can be themed. This is the root cause of "can't add dark mode" —
> not an aesthetic issue.

Enforced in CI by `contracts/design-tokens.md` §9 assertions T2 / T3.

---

### REQ-003: Theme control

SHALL provide a three-state theme toggle: `system` (default) / `dark` /
`light`.

| Item | Convention |
|------|------------|
| Persistence | localStorage `agent-observability.theme` |
| Default | `system`; resolves to `dark` when the system has no preference |
| Entry | icon button at the right of the global header, cycles system → dark → light |
| Icons | `system` → `device-desktop`; `dark` → `moon`; `light` → `sun` |
| System follow | under `system`, MUST listen to `matchMedia('(prefers-color-scheme: dark)')` changes and follow in real time |

---

### REQ-004: Icon set

SHALL provide `src/components/icons/index.tsx` exporting the following — and
**only** the following — 47 icon components. Implementation constraints in
`contracts/design-tokens.md` §8 (16×16 grid, `currentColor`, zero
dependencies, inline SVG).

Unified wrapper:

```tsx
export interface IconProps {
  size?: 12 | 16 | 20 | 24;   // default 16
  className?: string;
  /** omitted = aria-hidden decorative icon; provided = role="img" and renders <title> */
  label?: string;
}
```

**Navigation / views (8)**

| Name | Use |
|------|-----|
| `IconSessions` | sessions view |
| `IconAgents` | Agent overview view |
| `IconCompare` | compare view (git-compare shaped) |
| `IconProxy` | proxy view (double-arrow shaped) |
| `IconFrida` | Frida view (cpu shaped) |
| `IconSidebar` | collapse/expand left rail |
| `IconPanel` | collapse/expand right panel |
| `IconCommand` | ⌘ command palette |

**Phase (6)** — one-to-one with `--phase-*`, MUST appear together with the
color

`IconUnderstand`(telescope) · `IconPlan`(checklist) · `IconImplement`(code) ·
`IconDebug`(bug) · `IconVerify`(beaker) · `IconReport`(report)

**Status (6)**

`IconSuccess`(check-circle) · `IconError`(x-circle) · `IconRunning`(dot-fill) ·
`IconPending`(clock) · `IconCancelled`(skip) · `IconWarning`(alert)

**Event kinds (6)** — mapping `TraceEvent.kind`

`IconMessage` · `IconTool` · `IconFile` · `IconTerminal` · `IconThought` ·
`IconSystem`

**Metrics (4)** — Speed / Accuracy / Stability / Cost

`IconSpeed`(zap) · `IconAccuracy`(shield-check) · `IconStability`(pulse) ·
`IconCost`(coin)

**Actions (12)**

`IconSearch` · `IconFilter` · `IconRefresh` · `IconCopy` · `IconDownload` ·
`IconExternalLink` · `IconTrash` · `IconClose` · `IconChevronRight` ·
`IconChevronDown` · `IconKebab` · `IconPlus`

**Other (5)**

`IconGear`(settings) · `IconGlobe`(language) · `IconSun` · `IconMoon` ·
`IconDeviceDesktop`

> Total 8+6+6+6+4+12+5 = **47**. This table is the item-by-item canonical
> list; `contracts/design-tokens.md` §9 T6 asserts the export name set is
> exactly equal. The three theme icons MUST be independent; MUST NOT reuse
> each other's paths.

#### Scenario: icons do not carry isolated meaning
- **GIVEN** a Gantt row renders a phase
- **THEN** MUST render both the phase icon and the phase color
- **AND** the icon's `label` MUST be the i18n'd phase name (for screen
  readers)

---

### REQ-005: Base component list

SHALL provide generic components under `src/components/ui/`. Every component
MUST be a pure presentational piece with no business logic.

| Component | Variants / key props | Description |
|-----------|----------------------|-------------|
| `Button` | `variant: primary｜default｜danger｜ghost`, `size: sm(24px)｜md(28px)`, `icon`, `loading`, `disabled` | default `default`; `ghost` for dense rows |
| `IconButton` | same + required `label` | hit target >= 24×24, MUST have a tooltip |
| `Badge` | `tone: accent｜success｜attention｜danger｜done｜neutral`, `variant: subtle｜solid` | radius `--radius-sm`, `--text-xs` |
| `StatusBadge` | `status: TraceStatus` | contract §2.4 color + icon + i18n text |
| `PhaseBadge` | `phase: TracePhase` | color + icon + i18n text |
| `ProviderBadge` | `provider: ProviderKey`, `showLabel?` | monogram, color per contract §2.6 |
| `Field` | `label`, `hint`, `error`, wraps input/select | unified form row |
| `Input` / `Select` | `size: sm｜md`, `icon?` | same height as Button |
| `SearchInput` | built-in `IconSearch` + clear button + `/` focus | |
| `Tabs` | `variant: underline｜pill` | view switching uses `underline` (GitHub-style) |
| `Table` | `density: compact｜default`, `sortable`, `sticky header` | header `--canvas-subtle` + sticky |
| `Tooltip` | `placement`, 400ms delay | pure CSS + minimal JS positioning, no library |
| `Popover` / `DropdownMenu` | Esc close, outside click close, focus return | |
| `Modal` | `size: sm｜md｜lg`, focus trap | reused for Transcript / Token / Settings |
| `Drawer` | slides in from the right | proxy request detail |
| `Skeleton` | `variant: text｜row｜block`, `count` | see REQ-006 |
| `EmptyState` | `icon`, `title`, `description`, `action?` | see REQ-006 |
| `ErrorState` | `code`, `message`, `onRetry` | see REQ-006 |
| `Toast` | `tone`, auto-dismiss 4s, stackable | see REQ-007 |
| `Kbd` | renders key caps | `⌘K` / `j` / `Esc` |
| `MetricCard` | `icon`, `label`, `value`, `unit`, `trend?` | Speed/Accuracy/Stability/Cost KPIs |
| `BarMeter` | `value`, `max`, `tone` | inline table bar |
| `Sparkline` | `points: number[]` | inline SVG, no deps |
| `SplitPane` | `direction`, `min`, `max`, persisted width | left/right rail drag |
| `VirtualList` | reuses existing `useVirtualList` | see frontend REQ-006 |

---

### REQ-006: Four-state rendering contract (the core fix for "click and
nothing loads")

Any UI region that issues async requests SHALL explicitly render one of the
following four states; a fifth "renders nothing" state MUST NOT exist.

| State | Trigger | Render |
|-------|---------|--------|
| **loading** | request in flight and no cache | `Skeleton`, shaped like the final content (list → row skeleton, table → table skeleton) |
| **empty** | request succeeded, empty result | `EmptyState`: icon + one-line reason + actionable next step |
| **error** | request rejected / non-2xx | `ErrorState`: error code + i18n copy + **retry button** |
| **ready** | has data | normal content |

Plus one business state: **pending** (detail `pending: true`, decrypting) →
placeholder + wait for SSE, MUST NOT poll (existing REQ-009).

#### Scenario: no silent error swallowing
- **GIVEN** any `fetch` failure (network down, 500, timeout)
- **THEN** the region MUST enter the error state showing the error code and a
  retry button
- **AND** the `catch` block MUST NOT be empty and MUST NOT only contain a
  comment
- **AND** MUST also `console.error` the original error for developer
  debugging

> **Why this gets its own REQ**: the current `SampleRail.tsx:40`, App.tsx's
> `selectSession`, and EventInspector's `loadDetail` all have empty-comment
> catch blocks. Any failure looks like "clicked but nothing happened" — the
> #1 feel issue this round fixes. Enforced by `frontend/spec.md` REQ-021
> tests.

#### Scenario: skeleton does not jump
- **GIVEN** the session list is in the loading state
- **THEN** skeleton row height MUST equal the real row height (`--row-lg`)
- **AND** when data arrives, MUST NOT cause layout shift (CLS = 0)

---

### REQ-007: Feedback & notifications

- Destructive operations (delete session, stop proxy) SHALL ask for
  confirmation (`Modal` or inline confirm); MUST NOT execute directly.
- Background action results (scan complete, config saved, proxy started)
  SHALL use `Toast`; MUST NOT use `alert()`.
- Long-running actions (first scan, Trae decryption) SHALL show an in-progress
  indicator in the status bar instead of blocking the UI.
- Copy-type operations SHALL give in-place feedback (icon briefly becomes
  `IconSuccess`), no Toast needed.

---

### REQ-008: Keyboard & command palette

SHALL support the following shortcuts. On conflict, input focus wins (only
`Esc` works while an input is focused).

| Key | Behavior |
|-----|----------|
| `⌘K` / `Ctrl+K` | open command palette |
| `1`-`6` | switch to the nth view |
| `/` | focus the current view's search box |
| `j` / `k` | move down / up the list |
| `Enter` | open the selected item |
| `Esc` | close overlay / clear selection |
| `[` / `]` | collapse / expand left / right rails |
| `⌘\` | toggle theme |
| `?` | keyboard help overlay |

**Command palette** (`CommandPalette`) SHALL support: jump to session (fuzzy
match by title/id), switch views, toggle theme/language, trigger scan, open
settings. The list MUST be virtualized (sessions can reach hundreds).

#### Scenario: palette does not slow first screen
- **GIVEN** the app first loads
- **THEN** the command palette component MUST lazy-load (first instantiated on
  the first `⌘K`)
- **AND** MUST NOT prefetch the full session list on first screen

---

### REQ-009: Accessibility

| Item | Requirement |
|------|-------------|
| Contrast | meet all `contracts/design-tokens.md` §2.7 combinations |
| Focus | all interactive elements have a `:focus-visible` ring; focus trap inside overlays; focus returns to the trigger on close |
| Semantics | view tabs use `role="tablist"`; lists use `role="listbox"` + `aria-selected`; modals use `role="dialog"` + `aria-modal` |
| Dynamic regions | status-bar live indicator and Toasts use `aria-live="polite"` |
| Color | see REQ-004 Scenario; color never carries meaning alone |
| Reduced motion | animations go to zero under `prefers-reduced-motion` |
| Zoom | at 200% zoom, no horizontal scroll, no content truncation |

---

### REQ-010: Chart type selection & criteria line (add-mission-control)

The Mission view's widgets SHALL follow Tengu Lab's chart-type rule, promoted
to a hard requirement:

| Data shape | Chart |
|------------|-------|
| 占比 (share of a whole) | DonutChart |
| 趋势 (trend over time) | StackedAreaChart / line |
| 时间×类目 (time × category) | HeatmapGrid |
| 排行 (ranking) | HBarChart |
| 明细 (detail list) | Table |
| Trace | Gantt (existing TraceTimeline) |

**Every widget MUST carry a `criteria` line** rendered directly below its
title: the server-provided data provenance (`criteria` field: table /
fields / computation / coverage). The frontend MUST NOT write criteria text
itself — server-side delivery is what keeps the line in sync when SQL
changes. A widget with `available=false` renders `EmptyState` +
`unavailableReason`; a `criteria` line MUST NOT be invented on the client.

#### Scenario: criteria is server-owned
- **GIVEN** any Mission widget rendering
- **THEN** the criteria line is exactly the string returned by
  `GET /api/mission` for that widget's `criteria` field
- **AND** the frontend code contains no hardcoded criteria sentence for
  Mission widgets

### REQ-011: Performance constraints

Design must not violate the existing `contracts/nfr.md` budgets. Extra
constraints:

| Item | Budget |
|------|--------|
| Total CSS (gzipped) | < 16KB |
| Total icon set (uncompressed) | < 12KB |
| Theme switch to repaint complete | < 16ms (one frame) |
| New runtime deps | **0** (`project.md` §2 hard constraint) |
| CSS transitions inside virtual-scroll containers | **forbidden** |

#### Scenario: dense list scrolling without dropped frames
- **GIVEN** a session list of 500 rows and an event tree of 9,590 rows
- **WHEN** scrolling continuously for 3 seconds
- **THEN** dropped-frame rate < 5%
- **AND** rows MUST NOT use `box-shadow` / `filter` / `backdrop-filter`

---

## Gotchas

- **G-DS-1**: `--row-sm` / `--row-lg` are the `itemHeight` inputs for virtual
  scrolling; changing them changes offset math. Changing either token requires
  syncing the `useVirtualList` tests.
- **G-DS-2**: the theme script must be **inline synchronous** in `index.html`'s
  `<head>`, not in the bundle — in the bundle it runs after the first-paint
  CSS and always flashes.
- **G-DS-3**: listen to `prefers-color-scheme` with
  `addEventListener('change')`; `addListener` (below Safari 14) is deprecated.
  This project targets Node >= 20 / modern browsers; no compat shims.
- **G-DS-4**: don't add `transition: background` to `.rail-row` — virtual
  scrolling reuses rows, and transitions smear the hover color.
- **G-DS-5**: in the CJK font stack, `PingFang SC` must come before
  `Microsoft YaHei`, otherwise Chinese on macOS falls through to a missing
  font and the weights look fuzzy.
