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
| Entry | icon button at the bottom of the sidebar, cycles system → dark → light |
| Icons | `system` → `device-desktop`; `dark` → `moon`; `light` → `sun` |
| System follow | under `system`, MUST listen to `matchMedia('(prefers-color-scheme: dark)')` changes and follow in real time |

---

### REQ-004: Icon set

SHALL export the following canonical icon names. All use 16×16 viewBox, 1.5 currentColor stroke, round caps and joins, no fill. Existing names remain compatible; IconCost depicts layers, never currency.

`IconSessions`, `IconAgents`, `IconCompare`, `IconProxy`, `IconFrida`, `IconSidebar`, `IconPanel`, `IconCommand`, `IconUnderstand`, `IconPlan`, `IconImplement`, `IconDebug`, `IconVerify`, `IconReport`, `IconSuccess`, `IconError`, `IconRunning`, `IconPending`, `IconCancelled`, `IconWarning`, `IconMessage`, `IconTool`, `IconFile`, `IconTerminal`, `IconThought`, `IconSystem`, `IconSpeed`, `IconAccuracy`, `IconStability`, `IconCost`, `IconSearch`, `IconFilter`, `IconRefresh`, `IconCopy`, `IconDownload`, `IconExternalLink`, `IconTrash`, `IconClose`, `IconChevronRight`, `IconChevronDown`, `IconKebab`, `IconPlus`, `IconGear`, `IconGlobe`, `IconSun`, `IconMoon`, `IconDeviceDesktop`, `IconContrast`, `IconDashboard`, `IconList`, `IconGitCompare`, `IconFlask`, `IconNetwork`, `IconPlug`, `IconSettings`, `IconChevronUp`, `IconChevronLeft`, `IconCheck`, `IconX`, `IconMinus`, `IconMoreHorizontal`, `IconUpload`, `IconAlertTriangle`, `IconAlertCircle`, `IconCheckCircle`, `IconXCircle`, `IconInfo`, `IconClock`, `IconHourglass`, `IconCpu`, `IconDatabase`, `IconZap`, `IconUser`, `IconBot`, `IconUsers`, `IconWrench`, `IconFileText`, `IconEye`, `IconEyeOff`, `IconLanguages`, `IconPanelLeft`, `IconArrowUp`, `IconArrowDown`, `IconTrendingUp`, `IconTrendingDown`, `IconPlay`, `IconPause`, `IconSparkles`, `IconLayers`, `IconMessageSquare`, `IconGitBranch`.

IconProps retains optional size 12/16/20/24, className and label (label supplies title and role=img; omitted means aria-hidden).

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
| `Tooltip` | `placement`, 300ms delay | pure CSS + minimal JS positioning, no library |
| `Popover` / `DropdownMenu` | Esc close, outside click close, focus return | |
| `Modal` | `size: sm｜md｜lg`, focus trap | reused for Transcript / Token / Settings |
| `Drawer` | slides in from the right | proxy request detail |
| `Skeleton` | `variant: text｜row｜block`, `count` | see REQ-006 |
| `EmptyState` | `icon`, `title`, `description`, `action?` | see REQ-006 |
| `ErrorState` | `code`, `message`, `onRetry` | see REQ-006 |
| `Toast` | `tone`, auto-dismiss 3s, stackable | see REQ-007 |
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
  `IconSuccess`), also emits Toast.

---

### REQ-008: Keyboard & command palette

SHALL support the following shortcuts. On conflict, input focus wins (only
`Esc` works while an input is focused).

An active overlay owns non-Escape keys: native button activation and its local
keyboard handlers MUST NOT be consumed by background global navigation. Already
defaultPrevented events remain with their component/native owner. Global
shortcuts resume after overlays close; Esc still closes only the top overlay and
IME composition remains untouched.
Outside overlays, Enter/Space on focused native buttons/links/disclosure controls
also belongs to native activation, not the background selected-session shortcut.

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

The Mission view's widgets SHALL follow the chart-type rule below (promoted
from the reference implementation to a hard requirement):

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
| 首屏主 CSS gzip（first-screen main CSS） | ≤ 40KB (40,960 bytes) |
| Icon source (uncompressed) / expanded rendered SVG audit | <12KiB / <32KiB |
| Theme switch to repaint complete | < 16ms (one frame) |
| New runtime deps | **0** (`project.md` §2 hard constraint) |
| CSS transitions inside virtual-scroll containers | **forbidden** |

The historical total-CSS16KB limit predates the current evidence readers and
feature-owned styles. This local-first application serves assets locally without
network transfer cost; the enforceable budget is now the main CSS linked from
the built index.html, gzip <=40KiB. Lazy feature styles are outside this first-screen
measurement. Existing JS/HTML preload budgets in contracts/nfr.md are unchanged.
The build-output budget test reports actual main CSS bytes after npm run build.

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

## F2 foundation amendment

REQ-F2-001: Implement docs/design/ui-design-system.md §1–4. Button primary/secondary(default alias)/ghost/danger/link sm28/md32/lg36; custom Select and searchable single/multiple comboboxes; segmented control, checkbox/radio/switch, cards/stat/strip, callout, overlays, steps, accordion, copy/key-value/meter, table and charts. All controls keyboard accessible with controlled/uncontrolled and disabled states where relevant. Shared portal positioning flips at viewport edges, focus trap reused. Tooltip delay300ms, Toast3s.

REQ-F2-002: SVG chart family provides responsive ResizeObserver layout, axis/grid/legend, empty state, hover reference/values and reduced-motion. Charts use categorical/token/compare tokens. UI kit at #/ui-kit shows all components, icons, formatting and fixed explicitly labelled demonstration charts in both themes.

The icon source retains a12KiB uncompressed budget via pure shared path factories. Expanded rendered SVG audit is32KiB, accounting for repeated accessible wrappers across compatibility aliases. No dependencies. All existing nfr application budgets remain in force.

## F2 review acceptance

REQ-F2-003: All anchored overlays use one opaque canvas-overlay surface, border,
shadow-md, layer above sticky chrome; window capture scroll/resize and anchor/layer
ResizeObserver reposition; fully offscreen/clipped anchors close. Fixed-size option
icons16px/dots8px never flex. MultiCombobox chips contain real12px remove buttons,
never nested buttons, and overflow after two chips reads +N.

REQ-F2-004: Numeric chart axes use shared1/2/5×10^n ticks; explicit percent axes
span0–100%, ratio input by default (percentScale documents0–100 input). Token
format is one decimal with trailing .0 removed. StatCard sparklines are full content
width and40px high; change/comparison share the line immediately below the value.

REQ-F2-005: PageSkeleton replaces every Suspense fallback and page-level loading;
reader-specific pending/cancel states retain their existing meaning. Sidebar status
uses connection row plus compact session/event/database-size row, ghost refresh
scan button, and uniformly32px tooltip-equipped theme/language/display/collapse
controls. Collapsed sidebar keeps only icons/status dot.

REQ-F2-006: Table/DataTable offers controlled page selection including mixed header,
page-local select-all preserving off-page selections, row status stripes, mouse and
ArrowUp/Down/Enter activation, isolated child controls, hover action menus, controlled
expanded child rows, sticky title/utility columns, internal overflow, zero-based
controlled pagination/page size, bulk toolbar, skeleton rows and empty state.
UiKit demonstrates every behavior with labelled fixed data; no IO in Table.

## F6 shared component polish

REQ-F6-001: Shared component copy uses UiLocaleProvider/explicit locale with a
reactive document-language fallback. No separate component-copy language store.
SearchInput reserves icon and clear-button padding independent of button sizing.
REQ-F6-002: AreaChart/BarChart/LineChart legends use labelled native buttons with
aria-pressed. Visibility filters numeric axis, stacking, grouped bars and tooltips,
preserves series colors and retains restoration controls even if all are hidden.
Option titles truncate on one line with full Tooltip; metadata is a second line.
