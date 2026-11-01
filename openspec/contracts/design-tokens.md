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
| **Borders over shadows** | shadow-xs/sm for cards and selected blocks; shadow-md/lg for overlays | stacked card shadows |
| **Density is respect** | maximize per-screen information; monospace carries IDs and numbers | huge whitespace, huge radius, huge cards |
| **Color never carries information alone** | color always paired with an icon or text | only color dots distinguishing the 6 phases |

---

## 1. Theme mechanism

```
<html data-theme="dark">   ← explicit choice
<html data-theme="light">
<html>                     ← no choice: follow prefers-color-scheme; dark when no preference
```

- Persistence key: `awesome-telemetry.theme`, values `dark` | `light` |
  `system`, default `system`. **B6 backward-compat fallback**: the inline theme
  script and `useTheme()` read the new key first, fall back to the legacy
  `agent-observability.theme` key, and write the new key on a successful
  fallback read. This script runs synchronously before any CSS (G-DS-2) and
  MUST NOT flash on first paint. (The locale key `agent-observability.locale`
  is unchanged in this change.)
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
| `--canvas-inset` | `#09090b` | `#f6f7f9` | scroll-container bottoms, code block bottoms |
| `--canvas-default` | `#111113` | `#ffffff` | app main background |
| `--canvas-subtle` | `#1a1a1e` | `#f3f4f6` | sidebar, secondary panels, table headers |
| `--canvas-raised` | `#141417` | `#ffffff` | cards, row hover |
| `--canvas-overlay` | `#1a1a1e` | `#ffffff` | overlays: menus / popovers / modals |
| `--canvas-overlay-fg` | `#f4f4f5` | `#111827` | text on overlay surfaces (Compare Hero gradient) |

### 2.2 Border

| Token | Dark | Light | Use |
|-------|------|-------|-----|
| `--border-default` | `#27272a` | `#e5e7eb` | regular dividers, inputs |
| `--border-muted` | `#1f1f23` | `#eef0f3` | in-row list dividers (weaker) |
| `--border-strong` | `#3f3f46` | `#d1d5db` | hover state, emphasis border before focus |

### 2.3 Foreground

| Token | Dark | Light | Use |
|-------|------|-------|-----|
| `--fg-default` | `#f4f4f5` | `#111827` | body text |
| `--fg-muted` | `#a1a1aa` | `#4b5563` | secondary text, labels |
| `--fg-subtle` | `#8b8b94` | `#6b7280` | placeholders, disabled state |
| `--fg-on-emphasis` | `#ffffff` | `#ffffff` | text on solid emphasis backgrounds |

### 2.4 Semantic colors

Each group has three tiers: `-fg` (text/icon), `-emphasis` (solid background),
`-subtle` (light background / badge background).

| Group | Token prefix | Dark fg / emphasis / subtle | Light fg / emphasis / subtle | Semantics |
|-------|--------------|------------------------------|-------------------------------|-----------|
| accent | `--accent-` | `#a5b4fc` / `#5850ec` / `rgba(129,140,248,0.14)` | `#4f46e5` / `#4f46e5` / `rgba(79,70,229,0.08)` | selection, focus, links (indigo); primary uses inverse neutral |
| success | `--success-` | `#4ade80` / `#238636` / `rgba(46, 160, 67, 0.15)` | `#15803d` / `#15803d` / `rgba(22,163,74,0.10)` | success |
| attention | `--attention-` | `#fbbf24` / `#9e6a03` / `rgba(187, 128, 9, 0.15)` | `#b45309` / `#b45309` / `rgba(217,119,6,0.10)` | warning |
| danger | `--danger-` | `#f87171` / `#da3633` / `rgba(248, 81, 73, 0.15)` | `#dc2626` / `#dc2626` / `rgba(220,38,38,0.08)` | failure |
| done | `--done-` | `#c4b5fd` / `#8957e5` / `rgba(163, 113, 247, 0.15)` | `#7c3aed` / `#7c3aed` / `rgba(124,58,237,0.08)` | complete |
| neutral | `--neutral-` | `#a1a1aa` / `#6e7681` / `rgba(110, 118, 129, 0.15)` | `#4b5563` / `#6b7280` / `rgba(107,114,128,0.10)` | unknown |

**status → semantic color mapping** (`TraceSession.status` /
`TraceEvent.status`):

| status | Group | Icon |
|--------|-------|------|
| `success` | success | `check-circle` |
| `error` | danger | `x-circle` |
| `running` | accent | `dot-fill` (pulse animation) |
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
| `--fg-subtle` on `--canvas-default` | >= 4.5:1 | WCAG AA small text |
| any `*-fg` on `--canvas-default` | >= 4.5:1 | semantic text |
| any phase color on `--canvas-default` | >= 3:1 | non-text graphics |
| `--fg-on-emphasis` on any `*-emphasis` | >= 4.5:1 | solid buttons |

**Color must not carry information alone** (WCAG 1.4.1): phases must have
icons, statuses must have icons, and compare sides must carry `L` / `R`
markers rather than just blue/orange.

### 2.8 Role colours (add-trajectory-inspector)

Six message-role colour groups for the trajectory surface (design D19). Each
group has three tiers — `-fg` (text/icon), `-emphasis` (solid background),
`-subtle` (light background / badge background) — in **both** themes, plus a
mandatory icon. **Colour never carries the role alone**: every role marker,
turn badge, and ribbon legend entry pairs the role colour with its icon and
name (design-system REQ-009).

Each role's `-fg` is fixed by D19 and **reuses an existing product hue**; the
`-emphasis` and `-subtle` tiers inherit the values of that hue's existing
group in §2.4 / §2.5, so the palette stays single and no component writes a
colour literal (REQ-002):

| Role | Prefix | Dark fg / emphasis / subtle | Light fg / emphasis / subtle | Icon | Reuses hue of |
|------|--------|------------------------------|-------------------------------|------|---------------|
| system | `--role-system-` | `#f85149` / `#da3633` / `rgba(248,81,73,.15)` | `#d1242f` / `#cf222e` / `rgba(209,36,47,.1)` | `gear` | danger |
| user | `--role-user-` | `#3fb950` / `#238636` / `rgba(46,160,67,.15)` | `#1a7f37` / `#1f883d` / `rgba(26,127,55,.1)` | `command` | success |
| assistant | `--role-assistant-` | `#ab7df8` / `#8957e5` / `rgba(163,113,247,.15)` | `#8250df` / `#8250df` / `rgba(130,80,223,.1)` | `message` | done |
| tool | `--role-tool-` | `#39c5cf` / `#1b7c83` / `rgba(57,197,207,.15)` | `#1b7c83` / `#1b7c83` / `rgba(27,124,131,.1)` | `tool` | phase-understand |
| reasoning | `--role-reasoning-` | `#8b949e` / `#6e7681` / `rgba(110,118,129,.15)` | `#59636e` / `#6e7681` / `rgba(89,99,110,.1)` | `thought` | neutral |
| compact | `--role-compact-` | `#d29922` / `#9e6a03` / `rgba(187,128,9,.15)` | `#9a6700` / `#bf8700` / `rgba(154,103,0,.1)` | `chevron-down` | attention |

Plus the ribbon highlight token:

| Token | Dark | Light | Use |
|-------|------|-------|-----|
| `--ribbon-active` | `rgba(230,237,243,.28)` | `rgba(31,35,40,.18)` | active segment / two-way highlight on the turn ribbon (D10) |

The source spec's light-only `#F5F5F5` / `#FFFFFF` / `#1A202C` palette and its
red-for-selection are **not adopted** (deviation C1 / C3): this product is
dark-first with an equal light theme, and red means failure. Selection on the
trajectory surface uses the accent group (`--accent-`), never the danger group
(design-system selection semantics).

---

## 3. Typography

Local-first font stacks (no bundled or remote fonts):

```css
--font-ui: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
```

### 3.1 Font size scale

All sizes multiply ui-scale. xs12/16, sm12/16, base13/20, md14/20, lg16/24, xl20/28, 2xl24/32, 3xl28/36. Weights400/500/600. Numeric data uses tabular-nums.

### 3.2 User adjustment

Sidebar Display menu: small12, standard13, large14, reset13. Global ui-scale uses13 as denominator. Existing long-text controls remain available in evidence readers. No A-/A+/R in global header.

---

## 4. Spacing / radius / sizing

### 4.1 Spacing (4px base)

`--space-1: 4px` `--space-2: 8px` `--space-3: 12px` `--space-4: 16px`
`--space-5: 20px` `--space-6: 24px` `--space-8: 32px` `--space-10: 40px`

### 4.2 Radius

`--radius-sm: 6px` (controls, badges)
`--radius-md: 8px` (small cards, popovers)
`--radius-lg: 12px` (cards)
`--radius-xl: 16px` (dialogs)
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
| `--task-health-list-min-width` | `1060px` | desktop task health table; narrow cards override to zero |
| `--task-health-scroll-min-height` | `240px` | task health list minimum scroll viewport |

> `--row-sm` / `--row-lg` are the `itemHeight` inputs for virtual scrolling
> and **must be constants** — they must not vary with content, or
> `useVirtualList` offset math breaks (see gotchas G11.x virtual-scroll entry).

---

## 5. Shadows & overlays

| Token | Dark | Light |
|-------|------|-------|
| `--shadow-sm` | `0 1px 3px rgba(16,24,40,0.4), 0 1px 2px rgba(16,24,40,0.35)` | `0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)` |
| `--shadow-md` | `0 12px 24px -6px rgba(16,24,40,0.6), 0 2px 6px rgba(16,24,40,0.4)` | `0 12px 24px -6px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.06)` |
| `--shadow-lg` | `0 24px 48px -12px rgba(16,24,40,0.8)` | `0 24px 48px -12px rgba(16,24,40,0.24)` |

shadow-xs/sm are allowed on cards and selected blocks. shadow-md/lg are reserved for overlays. Virtual rows never use shadows. All surfaces retain border-default borders.

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
- Grid 16×16, `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"`, stroke-width1.5, round caps/joins, default
  `width/height = 16`.
- Allowed sizes: 12 / 16 / 20 / 24; any other size is a violation.
- Color **only** inherits `currentColor`; SVG MUST NOT hard-code colors.
- Every icon MUST have `aria-hidden="true"` (decorative) or
  `role="img" + <title>` (independently meaningful).
- Single icon path data <= 512 bytes; full icon source <=12KiB uncompressed; expanded rendered SVG audit <=32KiB (includes repeated accessible wrappers).

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

## F2 Calm Instrument amendment (authoritative; supersedes earlier numeric prose)

System theme remains the default. Primary buttons use fg-default on canvas-default inversely. All small text, including fg-subtle, meets AA 4.5:1 on its surface. Semantic emphasis backgrounds retain white-text AA; success/attention emphasis therefore use darker values than their decorative chart colors. Virtual row-sm/md/lg are unchanged. Sidebar controls replace header controls; copy actions emit Toast. Shadows xs/sm are allowed on cards and selected segments, md/lg only on overlays.

| Token | Dark | Light |
|---|---|---|
| `--canvas-inset` | `#09090b` | `#f6f7f9` |
| `--canvas-default` | `#111113` | `#ffffff` |
| `--canvas-subtle` | `#1a1a1e` | `#f3f4f6` |
| `--canvas-raised` | `#141417` | `#ffffff` |
| `--canvas-overlay` | `#1a1a1e` | `#ffffff` |
| `--canvas-overlay-fg` | `#f4f4f5` | `#111827` |
| `--border-default` | `#27272a` | `#e5e7eb` |
| `--border-muted` | `#1f1f23` | `#eef0f3` |
| `--border-strong` | `#3f3f46` | `#d1d5db` |
| `--fg-default` | `#f4f4f5` | `#111827` |
| `--fg-muted` | `#a1a1aa` | `#4b5563` |
| `--fg-subtle` | `#8b8b94` | `#6b7280` |
| `--accent-fg` | `#a5b4fc` | `#4f46e5` |
| `--accent-emphasis` | `#5850ec` | `#4f46e5` |
| `--accent-subtle` | `rgba(129,140,248,0.14)` | `rgba(79,70,229,0.08)` |
| `--success-fg` | `#4ade80` | `#15803d` |
| `--attention-fg` | `#fbbf24` | `#b45309` |
| `--danger-fg` | `#f87171` | `#dc2626` |
| `--done-fg` | `#c4b5fd` | `#7c3aed` |
| `--neutral-fg` | `#a1a1aa` | `#4b5563` |
| `--font-ui` | `"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` |
| `--font-mono` | `"JetBrains Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace` | `"JetBrains Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace` |
| `--radius-sm` | `6px` | `6px` |
| `--radius-md` | `8px` | `8px` |
| `--radius-lg` | `12px` | `12px` |
| `--radius-xl` | `16px` | `16px` |
| `--control-height-sm` | `28px` | `28px` |
| `--control-height-md` | `32px` | `32px` |
| `--control-height-lg` | `36px` | `36px` |
| `--sidebar-width` | `232px` | `232px` |
| `--sidebar-width-collapsed` | `56px` | `56px` |
| `--page-header-height` | `56px` | `56px` |
| `--page-gutter` | `24px` | `24px` |
| `--table-row-height` | `40px` | `40px` |
| `--table-row-height-dense` | `32px` | `32px` |
| `--chart-height` | `220px` | `220px` |
| `--sparkline-height` | `32px` | `32px` |
| `--tooltip-width` | `280px` | `280px` |
| `--sheet-width` | `640px` | `640px` |
| `--content-max-width` | `1600px` | `1600px` |
| `--text-3xl` | `calc(28px * var(--ui-scale))` | `calc(28px * var(--ui-scale))` |
| `--leading-md` | `calc(20px * var(--ui-scale))` | `calc(20px * var(--ui-scale))` |
| `--leading-sm` | `calc(16px * var(--ui-scale))` | `calc(16px * var(--ui-scale))` |
| `--chart-axis` | `var(--fg-subtle)` | `var(--fg-subtle)` |
| `--token-input` | `var(--chart-1)` | `var(--chart-1)` |
| `--token-output` | `var(--chart-2)` | `var(--chart-2)` |
| `--token-cache-read` | `var(--chart-5)` | `var(--chart-5)` |
| `--token-cache-write` | `var(--chart-6)` | `var(--chart-6)` |
| `--tooltip-delay` | `300ms` | `300ms` |
| `--chart-1` | `#818cf8` | `#6366f1` |
| `--chart-2` | `#2dd4bf` | `#14b8a6` |
| `--chart-3` | `#fbbf24` | `#f59e0b` |
| `--chart-4` | `#f472b6` | `#ec4899` |
| `--chart-5` | `#38bdf8` | `#0ea5e9` |
| `--chart-6` | `#a78bfa` | `#8b5cf6` |
| `--chart-7` | `#a3e635` | `#84cc16` |
| `--chart-8` | `#94a3b8` | `#64748b` |
| `--chart-grid` | `#1f1f23` | `#eef0f3` |
| `--compare-a` | `#94a3b8` | `#64748b` |
| `--compare-b` | `#818cf8` | `#4f46e5` |
| `--shadow-xs` | `0 1px 2px rgba(16,24,40,0.35)` | `0 1px 2px rgba(16,24,40,0.05)` |
| `--shadow-sm` | `0 1px 3px rgba(16,24,40,0.4), 0 1px 2px rgba(16,24,40,0.35)` | `0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)` |
| `--shadow-md` | `0 12px 24px -6px rgba(16,24,40,0.6), 0 2px 6px rgba(16,24,40,0.4)` | `0 12px 24px -6px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.06)` |
| `--shadow-lg` | `0 24px 48px -12px rgba(16,24,40,0.8)` | `0 24px 48px -12px rgba(16,24,40,0.24)` |

### F2 canonical icons (T6/T7)

`IconSessions`, `IconAgents`, `IconCompare`, `IconProxy`, `IconFrida`, `IconSidebar`, `IconPanel`, `IconCommand`, `IconUnderstand`, `IconPlan`, `IconImplement`, `IconDebug`, `IconVerify`, `IconReport`, `IconSuccess`, `IconError`, `IconRunning`, `IconPending`, `IconCancelled`, `IconWarning`, `IconMessage`, `IconTool`, `IconFile`, `IconTerminal`, `IconThought`, `IconSystem`, `IconSpeed`, `IconAccuracy`, `IconStability`, `IconCost`, `IconSearch`, `IconFilter`, `IconRefresh`, `IconCopy`, `IconDownload`, `IconExternalLink`, `IconTrash`, `IconClose`, `IconChevronRight`, `IconChevronDown`, `IconKebab`, `IconPlus`, `IconGear`, `IconGlobe`, `IconSun`, `IconMoon`, `IconDeviceDesktop`, `IconContrast`, `IconDashboard`, `IconList`, `IconGitCompare`, `IconFlask`, `IconNetwork`, `IconPlug`, `IconSettings`, `IconChevronUp`, `IconChevronLeft`, `IconCheck`, `IconX`, `IconMinus`, `IconMoreHorizontal`, `IconUpload`, `IconAlertTriangle`, `IconAlertCircle`, `IconCheckCircle`, `IconXCircle`, `IconInfo`, `IconClock`, `IconHourglass`, `IconCpu`, `IconDatabase`, `IconZap`, `IconUser`, `IconBot`, `IconUsers`, `IconWrench`, `IconFileText`, `IconEye`, `IconEyeOff`, `IconLanguages`, `IconPanelLeft`, `IconArrowUp`, `IconArrowDown`, `IconTrendingUp`, `IconTrendingDown`, `IconPlay`, `IconPause`, `IconSparkles`, `IconLayers`, `IconMessageSquare`, `IconGitBranch`.

This list supersedes earlier counts. All icons: viewBox0 0 16 16, stroke1.5 currentColor, round caps/joins, fill none; icon source budget12KiB, expanded rendered SVG audit32KiB. No currency glyph.

### F2 review tokens and formatting

--stat-sparkline-height:40px and --table-control-width:40px in both themes.
StatCard uses fluid SVG width with its40px height; inline sparklines retain32px.
Token compact values retain one decimal and strip trailing .0:292.7K,53.3M,1.2B,12K.
Anchored floating surfaces are opaque canvas-overlay with border-default/shadow-md,
above sticky chrome; the shared tooltip uses that surface with fg-default text.
