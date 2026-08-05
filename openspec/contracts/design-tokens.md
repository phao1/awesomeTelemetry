# Contract: Design Tokens

> **Authoritative numeric source** for the visual system. Same level as
> `data-model.md` / `database.md` / `api.md` / `nfr.md`: on component
> implementation conflicts, this file wins.
>
> Landing location: `src/styles/tokens.css` (single definition point).
> **No component CSS may contain literal colors or literal spacing** — only
> `var(--*)` references are allowed. This is testable, see
> `specs/design-system/spec.md` REQ-002.

---

## 0. Design stance

This is an observability tool for developers, modeled on GitHub / Linear /
Grafana trade-offs:

| Principle | Meaning | Anti-pattern |
|-----------|---------|--------------|
| **Dark first** | follow the system by default; dark when no preference | light by default, harsh at night |
| **Neutral grays carry structure** | hierarchy via canvas lightness difference + 1px borders | color everywhere, colorful cards |
| **Color expresses semantics only** | color = phase / status / diff, not decoration | brand color covering the UI |
| **Borders over shadows** | flat; shadows only for overlays (popover/modal) | stacked card shadows |
| **Density is respect** | maximize per-screen information; monospace carries IDs and numbers | huge whitespace, huge radius, huge cards |
| **Color never carries information alone** | color always paired with an icon or text | only color dots distinguishing the 6 phases |

---

## 1. Theme mechanism

```
<html data-theme="dark">   ← explicit choice
<html data-theme="light">
<html>                     ← no choice: follow prefers-color-scheme; dark when no preference
```

- Persistence key: `agent-observability.theme`, values `dark` | `light` |
  `system`, default `system`. (Same namespace as the existing
  `agent-observability.locale`)
- Theme switching MUST NOT trigger a full page reload and MUST NOT flash on
  first paint: tokens are defined on `:root`; switching only changes the
  `data-theme` attribute.
- Both themes share **exactly the same token key set**, only values differ. A
  missing key is a contract violation.

---

## 2. Colors

### 2.1 Canvas (background layers, dark to light)

| Token | Dark | Light | Use |
|-------|------|-------|-----|
| `--canvas-inset` | `#010409` | `#f6f8fa` | scroll-container bottoms, code block bottoms |
| `--canvas-default` | `#0d1117` | `#ffffff` | app main background |
| `--canvas-subtle` | `#161b22` | `#f6f8fa` | sidebar, secondary panels, table headers |
| `--canvas-raised` | `#1c2128` | `#ffffff` | cards, row hover |
| `--canvas-overlay` | `#21262d` | `#ffffff` | overlays: menus / popovers / modals |

### 2.2 Border

| Token | Dark | Light | Use |
|-------|------|-------|-----|
| `--border-default` | `#30363d` | `#d1d9e0` | regular dividers, inputs |
| `--border-muted` | `#21262d` | `#e4e8ec` | in-row list dividers (weaker) |
| `--border-strong` | `#6e7681` | `#8c959f` | hover state, emphasis border before focus |

### 2.3 Foreground

| Token | Dark | Light | Use |
|-------|------|-------|-----|
| `--fg-default` | `#e6edf3` | `#1f2328` | body text |
| `--fg-muted` | `#8b949e` | `#59636e` | secondary text, labels |
| `--fg-subtle` | `#6e7681` | `#818b98` | placeholders, disabled state |
| `--fg-on-emphasis` | `#ffffff` | `#ffffff` | text on solid emphasis backgrounds |

### 2.4 Semantic colors

Each group has three tiers: `-fg` (text/icon), `-emphasis` (solid background),
`-subtle` (light background / badge background).

| Group | Token prefix | Dark fg / emphasis / subtle | Light fg / emphasis / subtle | Semantics |
|-------|--------------|------------------------------|-------------------------------|-----------|
| accent | `--accent-` | `#4493f8` / `#1f6feb` / `rgba(56,139,253,.15)` | `#0969da` / `#0969da` / `rgba(9,105,218,.1)` | selection, links, primary buttons |
| success | `--success-` | `#3fb950` / `#238636` / `rgba(46,160,67,.15)` | `#1a7f37` / `#1f883d` / `rgba(26,127,55,.1)` | success, verification passed |
| attention | `--attention-` | `#d29922` / `#9e6a03` / `rgba(187,128,9,.15)` | `#9a6700` / `#bf8700` / `rgba(154,103,0,.1)` | warning, in progress |
| danger | `--danger-` | `#f85149` / `#da3633` / `rgba(248,81,73,.15)` | `#d1242f` / `#cf222e` / `rgba(209,36,47,.1)` | error, failure |
| done | `--done-` | `#ab7df8` / `#8957e5` / `rgba(163,113,247,.15)` | `#8250df` / `#8250df` / `rgba(130,80,223,.1)` | completed, archived |
| neutral | `--neutral-` | `#8b949e` / `#6e7681` / `rgba(110,118,129,.15)` | `#59636e` / `#6e7681` / `rgba(89,99,110,.1)` | unknown, empty |

**status → semantic color mapping** (`TraceSession.status` /
`TraceEvent.status`):

| status | Group | Icon |
|--------|-------|------|
| `success` | success | `check-circle` |
| `error` | danger | `x-circle` |
| `running` | attention | `dot-fill` (pulse animation) |
| `pending` | neutral | `clock` |
| `cancelled` | neutral | `skip` |

### 2.5 Phase colors (product signature, 6 colors)

The six phases of `TRACE_PHASES`. **MUST be paired with icons**; color alone
must not carry meaning (see §2.7).

| phase | Token | Dark | Light | Icon | Semantics |
|-------|-------|------|-------|------|-----------|
| understand | `--phase-understand` | `#39c5cf` | `#1b7c83` | `telescope` | reading code, exploring |
| plan | `--phase-plan` | `#a371f7` | `#8250df` | `checklist` | planning, breaking down |
| implement | `--phase-implement` | `#58a6ff` | `#0969da` | `code` | writing code, editing files |
| debug | `--phase-debug` | `#f0883e` | `#bc4c00` | `bug` | troubleshooting, retrying |
| verify | `--phase-verify` | `#3fb950` | `#1a7f37` | `beaker` | running tests, validating |
| report | `--phase-report` | `#db61a2` | `#bf3989` | `report` | summarizing, delivering |

Each phase also has a `-subtle` variant (same hue, 15% alpha in Dark, 10% in
Light) for tile backgrounds and Gantt bar backgrounds.

> **understand(cyan) and implement(blue) are the closest pair in the group** —
> an accepted trade-off: they rarely sit adjacent on the timeline, and their
> icons (telescope vs code) differ clearly.

### 2.6 Provider identity colors

The 9 providers use **monogram badges** rather than vendor logos — avoids
trademark issues, and 9 logos can't be styled consistently. Badge = 16×16
rounded square, background = that color's `-subtle`, text = that color, one
uppercase letter.

| provider | Letter | Dark | Light |
|----------|--------|------|-------|
| claude | `C` | `#d97757` | `#bc4c2e` |
| codex | `X` | `#10a37f` | `#0d7a5f` |
| opencode | `O` | `#4493f8` | `#0969da` |
| codearts | `A` | `#e5484d` | `#c0353a` |
| codeagent | `G` | `#f2a93b` | `#b87d1a` |
| codeagent2 | `2` | `#a371f7` | `#8250df` |
| trae | `T` | `#39c5cf` | `#1b7c83` |
| qoder | `Q` | `#db61a2` | `#bf3989` |
| workbuddy | `W` | `#8b949e` | `#59636e` |

### 2.7 Hard contrast requirements

| Combination | Minimum contrast | Basis |
|-------------|------------------|-------|
| `--fg-default` on `--canvas-default` | >= 12:1 | body text |
| `--fg-muted` on `--canvas-default` | >= 4.5:1 | WCAG AA body |
| `--fg-subtle` on `--canvas-default` | >= 3:1 | WCAG AA large text / non-text |
| any `*-fg` on `--canvas-default` | >= 4.5:1 | semantic text |
| any phase color on `--canvas-default` | >= 3:1 | non-text graphics |
| `--fg-on-emphasis` on any `*-emphasis` | >= 4.5:1 | solid buttons |

**Color must not carry information alone** (WCAG 1.4.1): phases must have
icons, statuses must have icons, and compare sides must carry `L` / `R`
markers rather than just blue/orange.

---

## 3. Typography

```css
--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
           "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", "Courier New", monospace;
```

CJK families must be in the stack (UI is zh/en bilingual), and MUST NOT load
any webfont (offline-capable, zero network requests).

### 3.1 Font size scale

| Token | size / line-height | Use |
|-------|--------------------|-----|
| `--text-xs` | 11px / 16px | badges, status bar, table corner labels |
| `--text-sm` | 12px / 18px | list secondary rows, meta, mono IDs |
| `--text-base` | 13px / 20px | **default body** (dev-tool density) |
| `--text-md` | 14px / 21px | emphasized body, buttons |
| `--text-lg` | 16px / 24px | panel titles |
| `--text-xl` | 20px / 28px | session titles |
| `--text-2xl` | 24px / 32px | KPI numbers |

Only three weights: `--weight-normal: 400`, `--weight-medium: 500`,
`--weight-semibold: 600`.

### 3.2 User font-size adjustment (existing REQ-012)

A- / A+ / R only apply to **long-text areas** (inspector body, transcript,
report), range 8-28px, injected via `--user-font-size`.
MUST NOT affect chrome (toolbars, sidebar, status bar) — otherwise the layout
falls apart.

---

## 4. Spacing / radius / sizing

### 4.1 Spacing (4px base)

`--space-1: 4px` `--space-2: 8px` `--space-3: 12px` `--space-4: 16px`
`--space-5: 20px` `--space-6: 24px` `--space-8: 32px` `--space-10: 40px`

### 4.2 Radius

`--radius-sm: 4px` (badges, tags)
`--radius-md: 6px` (**default**: buttons, inputs, cards)
`--radius-lg: 8px` (modals, popovers)
`--radius-full: 999px` (pills, status dots)

### 4.3 Fixed sizes (layout skeleton)

| Token | Value | Use |
|-------|-------|-----|
| `--header-height` | `48px` | global header |
| `--tabs-height` | `40px` | view tab bar |
| `--statusbar-height` | `28px` | bottom status bar |
| `--rail-width` | `300px` | left list default width (draggable, 260-480) |
| `--inspector-width` | `420px` | right detail default width (draggable, 280-900) |
| `--row-sm` | `28px` | event rows, compact table rows |
| `--row-md` | `32px` | regular table rows |
| `--row-lg` | `44px` | session list rows (two-line dense) |

> `--row-sm` / `--row-lg` are the `itemHeight` inputs for virtual scrolling
> and **must be constants** — they must not vary with content, or
> `useVirtualList` offset math breaks (see gotchas G11.x virtual-scroll entry).

---

## 5. Shadows & overlays

| Token | Dark | Light |
|-------|------|-------|
| `--shadow-sm` | `0 1px 0 rgba(1,4,9,.2)` | `0 1px 0 rgba(31,35,40,.04)` |
| `--shadow-md` | `0 8px 24px rgba(1,4,9,.6)` | `0 8px 24px rgba(66,74,83,.12)` |
| `--shadow-lg` | `0 16px 32px rgba(1,4,9,.85)` | `0 16px 32px rgba(66,74,83,.2)` |

Shadows are **only** allowed for: popover, dropdown, modal, toast, command
palette. List rows, cards, and panels always use `--border-default` borders.

### 5.1 Stacking order

`--z-sticky: 10` · `--z-drag: 20` · `--z-dropdown: 100` · `--z-popover: 200`
· `--z-modal: 300` · `--z-toast: 400` · `--z-palette: 500`

---

## 6. Motion

```css
--duration-fast: 80ms;    /* hover, press */
--duration-base: 160ms;   /* expand, fade in */
--duration-slow: 240ms;   /* overlays, drawers */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

**Hard constraints**:

1. Under `@media (prefers-reduced-motion: reduce)`, all durations MUST go to
   zero and skeleton shimmer and the running-state pulse MUST stop.
2. MUST NOT transition `width` / `height` / `top` / `left` — only
   `opacity` / `transform` / `background-color` / `border-color` / `color`.
   **No transitions inside virtual-scroll containers.**

---

## 7. Focus & hit targets

```css
--focus-ring: 0 0 0 2px var(--canvas-default), 0 0 0 4px var(--accent-emphasis);
```

- Every interactive element MUST have a `:focus-visible` focus ring; MUST NOT
  use `outline: none` without compensation.
- Minimum hit target 24×24px (icon buttons in dense rows use transparent
  padding to grow the target without growing the visual size).
- Keyboard order MUST match visual order.

---

## 8. Icons

- **Zero dependencies**: hand-written inline SVG, no icon library
  (`project.md` §2 dependency constraints).
- Grid 16×16, `viewBox="0 0 16 16"`, `fill="currentColor"`, default
  `width/height = 16`.
- Allowed sizes: 12 / 16 / 20 / 24; any other size is a violation.
- Color **only** inherits `currentColor`; SVG MUST NOT hard-code colors.
- Every icon MUST have `aria-hidden="true"` (decorative) or
  `role="img" + <title>` (independently meaningful).
- Single icon path data <= 512 bytes; full set <= 12KB (uncompressed).

Icon list and naming: `specs/design-system/spec.md` REQ-004.

---

## 9. Contract tests

The following assertions MUST be in CI (`src/styles/tokens.test.ts`):

| # | Assertion |
|---|-----------|
| T1 | the token key sets of `:root` and `[data-theme="light"]` in `tokens.css` are **exactly equal** |
| T2 | outside `tokens.css`, `src/**/*.css` MUST NOT contain `#[0-9a-f]{3,8}` literal colors |
| T3 | outside `tokens.css`, `src/**/*.css` MUST NOT contain non-`var()` `px` spacing (except `0px`/`1px` borders) |
| T4 | all §2.7 contrast combinations pass in both themes (computed with the WCAG relative-luminance formula, no library) |
| T5 | the 6 phase colors are pairwise ΔE > 15 (CIE76), ensuring distinguishability |
| T6 | the icon-set export names match the REQ-004 list **item for item**, no more no less |
| T7 | every icon SVG contains `viewBox="0 0 16 16"` and no `fill="#` / `stroke="#` |
