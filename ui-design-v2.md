# AwesomeTelemetry UI Design v2

> This is an optimization design over `ui-spec.md` (the v1 status quo). The
> goal is not to add features but to **re-arrange the information hierarchy**:
> turn the tool from "displaying data" into "answering questions".
>
> Written for implementation agents, including concrete layout, data
> structures, interaction rules, and acceptance criteria.

---

## 0. Design principles

Four principles; every later design decision derives from them. On conflict,
the lower-numbered principle wins.

### P1 · Conclusion First

The first visual focus of any screen must be the **conclusion**, not raw
data.

When a user opens the tool, they have only three questions in mind: **why is
this Agent slow / why did it fail / where did the tokens go**. v1 spreads out
6 phases, 19 metric rows, and 4 charts and lets the user draw conclusions —
that pushes the analysis work back onto the user.

v2 requires: every judgment that can already be computed is stated in words
directly; raw data moves to the second layer.

### P2 · Diff First

In compare scenarios, **equal data is noise**.

If 12 of 19 metric rows differ by under 10%, those 12 rows only dilute the
signal of the other 7. By default show only the differing parts; fold the rest
into one collapsed summary row.

### P3 · Semantic Collapse

Long-session readability is not solved by scroll performance; it is solved by
**grouping noisy events into meaningful blocks**.

Five consecutive `Read`s are one action to the analyst, not five events;
`Edit → Test Fail → Edit` is one repair loop, not three events. After
collapsing, a 500-step session usually leaves 50-80 rows.

### P4 · Every control has a function (No Placeholder)

v1 has several placeholder buttons (collapse / copy / open / Alerts /
absolute-time dropdown). **A placeholder control hurts trust more than no
control** — the user clicks once, nothing happens, and starts doubting the
whole UI.

v2 rule: a control is either implemented or removed. During transition,
`disabled + tooltip explaining why` is allowed, but "clicked and nothing
happened" is not.

---

## 1. Information architecture: three-layer convergence model

v1's problem is that every view is **flat**. v2 unifies into three layers:

```
L1  Conclusion layer  — readable within one screen; answers "what happened"
               auto-generated text judgments + 3-5 key numbers
               always expanded, not collapsible

L2  Dimension layer   — answers "why"
               cards grouped by analysis dimension (Speed/Cost/Quality or
               phase/tool/token)
               expanded by default, collapsible

L3  Detail layer      — answers "where is the evidence"
               raw events, full metric tables, Raw JSON, charts
               collapsed by default, expanded on demand
```

Layer mapping of the three main views:

| View | L1 conclusion layer | L2 dimension layer | L3 detail layer |
|------|---------------------|--------------------|------------------|
| Session | session findings card | phase tiles + time composition bar | Gantt / event detail / Raw |
| Agent overview | agent ranking and conclusions | per-agent metric cards | session list drill-down |
| Compare | verdict card (who wins, by how much) | Speed/Cost/Quality dimension cards | metric table / tool table / charts / Transcript |

---

## 2. Global layout

The three-column structure stays; Icon Nav and SampleRail widths unchanged.
The main changes are at the top of the Workspace.

```
┌──────┬──────────────┬────────────────────────────────────────────────┐
│ Icon │  SampleRail  │  Workspace                                     │
│ Nav  │              │  ┌──────────────────────────────────────────┐  │
│ 56px │  320px       │  │ ViewTabs   [⌘K search]  [mode]  [☾] [export] │  │← 40px fixed
│      │              │  ├──────────────────────────────────────────┤  │
│      │              │  │ ContextBar (sticky, appears after scroll) │  │← 36px conditional
│      │              │  ├──────────────────────────────────────────┤  │
│      │              │  │                                          │  │
│      │              │  │  L1 / L2 / L3 content area (scrollable)  │  │
│      │              │  │                                          │  │
│      │              │  └──────────────────────────────────────────┘  │
└──────┴──────────────┴────────────────────────────────────────────────┘
```

### 2.1 New: ContextBar (scrolling context bar)

**Problem**: the compare view's 8+ blocks run vertically; by the 6th screen
the user has forgotten who is being compared and who is ahead.

**Solution**: when the content area scrolls past 240px, a 36px sticky bar
slides out below the top bar:

- Left: current context summary
  - Session view → `ClaudeCode · refactor auth module · 8m32s · 142 events`
  - Compare view → `Codex ▍vs▍ ClaudeCode · overall 2:1 Codex leads`
- Middle: block anchor navigation (current block highlighted, click to jump)
- Right: `collapse all / expand all`

Auto-hides when scrolled back to top. Uses `IntersectionObserver` to
determine the current block.

### 2.2 New: global search (⌘K / Ctrl+K)

A must-have for trace tools that v1 completely lacked. Analogous to Chrome
DevTools' filter.

**Search domain**: event titles, file paths, Bash commands, tool names,
input/output summaries, error messages.

**Behavior**:
- instant filtering; the Gantt keeps only hit rows + their parent groups
- matched keywords are highlighted in event rows and the detail panel
  (yellow background)
- top shows `12 matches · ↑↓ jump · Esc exit`
- prefix filters supported: `file:auth.ts`, `tool:Bash`, `status:failed`,
  `phase:debug`

**Implementation requirement**: the search index is built once when a session
loads (flatten the searchable fields of events into string arrays), avoiding
tree traversal on every keystroke.

---

## 3. View 1: Session workbench v2

Top to bottom: session findings card → time composition bar → phase tiles →
Gantt + detail panel.

### 3.1 [New · L1] Session findings card (SessionFindings)

**This is the most important new component of v2.** Position: below the
session info card, above the phase tiles.

It translates what the tool already computed into human language. Every
Finding is clickable → locates and selects the corresponding event.

```
┌─ Session findings ────────────────────────────────────────── collapse ─┐
│                                                                        │
│  🔴  Debugging took 62% of the time                                    │
│      5m18s / 8m32s, concentrated in 3 repair loops around auth.ts →   │
│                                                                        │
│  🟠  Single npm test step took 4m12s                                   │
│      31% of the whole session; the longest single event           →   │
│                                                                        │
│  🟡  Blind writes: 3 files                                             │
│      utils/jwt.ts and 2 others were rewritten without a prior Read →  │
│                                                                        │
│  🔵  Tokens concentrated in the system prompt                          │
│      38% of input tokens are repeated system prompt, sent 14 times →  │
│                                                                        │
│                                            view all 7 findings ▾      │
└────────────────────────────────────────────────────────────────────────┘
```

**Finding data structure**:

```ts
type Finding = {
  id: string;
  severity: 'critical' | 'warning' | 'notice' | 'info';  // decides the color dot
  category: 'time' | 'token' | 'quality' | 'stability';
  title: string;           // one-sentence conclusion, <= 20 chars, includes a key number
  detail: string;          // one-sentence evidence, <= 40 chars
  evidence: {
    eventIds: string[];    // highlighted/located in the Gantt on click
    phase?: PhaseId;
    metric?: { key: string; value: number; unit: string };
  };
};
```

**Default rule set (v2 first batch of 10)**:

| # | Rule | Trigger | severity |
|---|------|---------|----------|
| 1 | single phase time share too high | any phase > 50% of total duration | warning |
| 2 | extra-long single event | one event > 20% of total duration | warning |
| 3 | repair loop | >= 2 identified edit→fail→edit cycles | critical |
| 4 | blind file write | file Write/Edit without prior Read | warning |
| 5 | no verification wrap-up | verify-phase event count = 0 | critical |
| 6 | high tool failure rate | any tool failure rate > 30% with >= 3 calls | warning |
| 7 | repeated system prompt share | repeated system-prompt tokens > 30% of input | notice |
| 8 | excessive idle | non-model non-tool gaps > 15% of total duration | notice |
| 9 | slow first token | TTFT > 5s | notice |
| 10 | user forced into repeated intervention | user_prompt events >= 4 | notice |

**Copy rules**: the title must contain a number and must be a judgment, not a
description.

- ✅ `Debugging took 62% of the time`
- ❌ `Debug phase duration statistics`
- ✅ `Blind writes: 3 files`
- ❌ `Read-write ratio: 0.62`

**Empty state**: `No significant issues found in this session. All 7 checks
passed →` (expandable to see the passed items)

### 3.2 [New · L2] Time composition bar (TimeCompositionBar)

**Problem**: v1's time band is colored only by phase; you can't see whether
time was eaten by the model or by tools. Yet that is exactly the key to
attributing the "Speed" dimension.

**Solution**: add a 28px stacked bar above the phase tiles, splitting total
duration by **execution semantics** instead of phase:

```
total 8m32s
┌──────────────────────────────────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓│████████████████████████████████│░░░░░░░│▒▒▒▒▒▒▒│
└──────────────────────────────────────────────────────────────┘
  model inference     tool execution               idle      user wait
  2m10s (25%)         5m02s (59%)                  48s(9%)   32s(6%)
```

| Segment | Definition | Color |
|---------|-------------|-------|
| model inference | LLM request sent to response end | teal-600 |
| tool execution | tool_call start to end | slate-500 |
| idle | gaps not covered by any event | slate-200 hatch |
| user wait | gaps between user_prompts | amber-300 |

The ratio of these four segments directly decides the optimization direction:
model slow → switch model/tune params; tool slow → optimize tool
implementation; high idle → orchestration problem. **This is information the
Gantt cannot show.**

Clicking any segment → the Gantt filters to the matching events.

### 3.3 Phase tiles (rework)

Keep the 6 tiles, three adjustments:

1. **Add a comparison baseline**: each tile shows the phase's duration share +
   deviation from that Agent's historical average (`↑ 18% above average`).
   Not shown when no baseline data.
2. **Multi-select filtering**: v1 was single-select; change to multi-select
   (click toggles), supporting "debug + verify only".
3. **Anomaly markers**: phases hit by a Finding show the severity color dot in
   the tile's top-right corner; clicking jumps to that Finding.

### 3.4 Gantt v2 (TraceGanttTree)

Core rework: **semantic collapse**. This is the key to long-session
readability, above virtual scrolling.

#### 3.4.1 Grouping rules

Events pass through a `groupEvents()` transform before rendering, producing a
group tree. Rules match in order; the first hit wins:

| Priority | Group type | Match rule | Collapsed title |
|----------|-----------|------------|------------------|
| 1 | `repair_loop` | loop of `Edit/Write → failed Bash/Test → Edit/Write`, >= 2 rounds | `repair loop ×3 (8 steps, 2m14s)` |
| 2 | `retry_burst` | same tool called >= 3 consecutive times with a failure | `Bash ×4 (3 failures, 18s)` |
| 3 | `read_burst` | >= 3 consecutive Read/Glob/Grep with no write in between | `read 5 files (1.2s)` |
| 4 | `write_batch` | >= 3 consecutive Edit/Write hitting the same directory | `edited 4 files under src/auth/ (22s)` |
| 5 | `subagent` | all events from subagent_prompt to its end | `subagent: search test cases (12 steps, 34s)` |

Events matching no rule stay as independent rows.

#### 3.4.2 Presentation of group rows

```
 #    operation                         type       status  timeline
────────────────────────────────────────────────────────────────────
 ▍ 12  ▸ read 5 files                    group      ✓      ▬▬              1.2s
 ▍ 17  Edit  src/auth/jwt.ts           tool      ✓        ▬▬▬           3.1s
 ▍ 18  ▾ 🔴 repair loop ×3               group      ✗          ▬▬▬▬▬▬▬▬   2m14s
 ▍  ├ 19  Bash  npm test               tool      ✗          ▬▬          18s
 ▍  ├ 20  Edit  src/auth/jwt.ts        tool      ✓            ▬         2s
 ▍  ├ 21  Bash  npm test               tool      ✗             ▬▬       19s
 ▍  └ … (expand to see remaining 5 steps)
 ▍ 27  ▸ Bash ×4 (3 failures)            group      ✗                ▬▬▬   18s
```

- the group row's Gantt bar = first event start to last event end, colored by
  the group's dominant phase
- the group row's left color bar: failure red when the group contains a
  failure; otherwise the dominant phase color
- `repair_loop` groups default to **expanded** (that's the problem), others
  default **collapsed**
- the group title's right side shows a severity icon (when linked to a
  Finding)
- global switch: `semantic groups [on/off]`; off returns to v1's flat list

#### 3.4.3 Collapse state and shortcuts

- the header gains `collapse all / expand all` (this button was a placeholder
  in v1; v2 implements it)
- keyboard: `j/k` move selection up/down; `h/l` collapse/expand the current
  group; `Enter` open detail; `/` invoke search
- selection follows the keyboard and auto-scrolls into view

#### 3.4.4 Timeline and zoom

- **relative/absolute time toggle lands**: relative shows `0s / 2m / 4m`;
  absolute shows `14:23:05 / 14:25:05`. Toggling synchronously reformats
  event start/end times.
- **range zoom**: drag a selection on the header timeline → the Gantt zooms
  to that range; a chip `focused 2m10s-3m40s ✕` appears at the top; clicking
  ✕ or double-click restores. Wheel + `⌘` zooms; drag pans.
- zoom, phase filtering, and search filtering stack; when any is active, a
  filter-chip group shows at the Gantt top, individually clearable.

#### 3.4.5 Virtual scrolling

After semantic collapse, row counts are usually < 100; virtual scrolling is
the fallback: enabled when **visible expanded rows > 200**
(`@tanstack/react-virtual`). Fixed row height 32px avoids dynamic measuring.
The list max height changes from a fixed 590px to `min(60vh, 720px)`.

### 3.5 Event detail panel v2 (EventInspector)

| Problem | v2 solution |
|---------|-------------|
| fixed 360px, long content truncated | draggable (320-720px), width persisted in localStorage |
| long diffs / big JSON unreadable | new "expand to full-screen drawer" button, drawer 80vw |
| Raw JSON cannot be located | in-panel `⌘F` local search, hit highlight + count |
| copy button does nothing | implement: copies the current tab's content; button becomes `copied` for 1.5s |
| narrow screens push it below and hurt UX | below 1280px it becomes a right-side overlay drawer, no longer squeezing the Gantt |

New capabilities:

- the input/output tab's diff view gains a "changed lines only" toggle; long
  files collapse unchanged sections by default (showing `… 42 lines
  unchanged ▾`)
- the detail panel top gains **previous / next step** navigation (`←` `→`),
  allowing sequential browsing without returning to the Gantt
- step numbers like `3.2` gain a tooltip explaining their meaning (phase 3,
  step 2)

---

## 4. View 2: Agent overview v2

Small changes, two items:

### 4.1 [New · L1] top conclusion strip

Above the card list, add one conclusion row:

```
5 agents · 87 sessions · combined assessment

  fastest  Codex        avg 4m12s, 2.3× faster than the slowest
  cheapest ClaudeCode   avg 18.2k tokens/session
  most stable  Codex    failure rate 4.1%, 0.3 repair loops/session
```

### 4.2 Cards become sortable and comparable

- a sort-dimension switcher at the top: `by duration / by tokens / by failure
  rate / by verification coverage`
- every card gains a checkbox; checking two → a floating `compare these two →
  ` button appears, jumping straight to the compare view (v1 required the
  user to hunt through SampleRail themselves)

---

## 5. View 3: Compare analysis v2 (CompareBoard)

v1's 8+ vertical blocks are the biggest usability problem. v2 re-arranges them
per the three-layer convergence; **the block order is completely changed**.

### 5.1 New block order

```
L1 ── ① verdict summary (was ⑨; moved from the end to the front)     always expanded
       ② key metrics grid (was ①)                                    always expanded

L2 ── ③ three-dimension compare: Speed/Cost/Quality (was ②)          expanded by default
       ④ time composition & phase compare (③⑤ merged)               expanded by default

L3 ── ⑤ detailed metric table (was ⑥, diff first)                   collapsed by default
       ⑥ tool call analysis (was ⑦)                                  collapsed by default
       ⑦ timeline compare (was ④)                                    collapsed by default
       ⑧ visual charts (was ⑧, trimmed)                              collapsed by default
       ⑨ Transcript                                                  modal, takes no layout space
```

Combined with §2.1's ContextBar for anchor navigation.

### 5.2 ① Verdict summary (Hero rework)

v1's Hero is a purely decorative gradient + "A vs B". v2 makes it carry the
conclusion:

```
┌──────────────────────────────────────────────────────────────────┐
│  Codex  ▍ vs ▍  ClaudeCode                                       │
│                                                                   │
│  overall 2 : 1  —  Codex faster and cheaper, ClaudeCode better    │
│  code quality                                                     │
│                                                                   │
│  ⚡ Speed   Codex leads      4m12s vs 8m32s, 2.0× faster          │
│  💰 Cost    Codex leads      18.2k vs 31.5k tokens, 42% less      │
│  ✨ Quality ClaudeCode leads 100% vs 40% verification, 0 vs 3 loops│
└──────────────────────────────────────────────────────────────────┘
```

Each row is clickable → scrolls to the matching dimension card. The gradient
background stays but at lower saturation so it doesn't compete with text.

### 5.3 ② Key metrics grid

Keep the 6 clickable KPI cards and drill-down, two adjustments:

- cards gain a **delta badge**: under `Tokens 18.2k` add `-42% vs
  ClaudeCode`, in win/loss colors
- the drill-down panel changes from "expands below the card, pushing layout"
  to "expands in a fixed container below the grid", avoiding page jumps

### 5.4 ③ Three-dimension compare (diff first)

The per-metric comparisons inside each dimension card stay, but apply P2:

- metric rows with < 10% difference default to a collapsed
  `4 insignificant differences ▾` at the bottom
- remaining metrics sort by **difference magnitude descending** (biggest
  difference first), not fixed order
- each row's right side gains a difference bar: a horizontal bar with the
  midline as origin extending toward the winning side; length = relative
  difference percent. Making "how much difference" visual instead of two
  numbers

The dimension verdict at the bottom stays, but becomes one attributed
sentence: `Codex leads — mainly from 62% fewer tool calls, not faster
individual calls`.

### 5.5 ④ Time composition & phase compare (merged)

Merge v1's ③ speed metrics and ⑤ phase-duration compare into one block,
because they answer the same question (where did the time go):

- top: left/right §3.2 **time composition bars** (model/tool/idle/wait),
  directly comparable
- bottom: 6-row double-bar phase compare (v1 design kept)
- side: TTFT / TPS cards (kept)

### 5.6 ⑤ Detailed metric table (diff first)

The 19-row table shows only rows with >= 10% difference by default; the rest
collapse into `12 insignificant differences ▾`.

New: sort by difference magnitude at the column head (default descending),
keeping the "advantage" column badges.

### 5.7 ⑧ Visual charts (trimmed)

v1 had 4 SVG charts. Assessed by "decision value":

| Chart | Disposition | Reason |
|-------|-------------|--------|
| radar (8 axes) | **keep** | multi-dimensional shape is comparable at a glance; the only chart giving an "overall profile" |
| donut (token composition) | **replace** | swap for two horizontal stacked bars, comparable on one screen and space-saving. A donut can't be left/right compared |
| phase bar chart | **remove** | duplicates §5.5's phase compare |
| event-kind distribution | **keep but collapsed** | the 10-kind distribution helps debugging adapters but isn't a frequent look |

Principle: a chart either supports a judgment or it is decoration.

---

## 6. Global: color system convergence

### 6.1 Current problems

v1 can show four color sources on one screen: 6 phase colors (each with light
and dark variants = 12) + 10 Agent brand colors + 4 status colors + 2
Prompt-specific colors ≈ **28 colors**.

The result: color loses its encoding power — users cannot build a stable
"this color = that meaning" mapping.

### 6.2 Convergence rules

**One visual channel encodes exactly one dimension.**

| Dimension | Encoding channel | Notes |
|-----------|------------------|-------|
| phase | **color** (6 hue families) | the only dimension using large color areas |
| status | **icon + border**, no fill color | ✓ success, ✗ failure, ⟳ running; failures additionally get a red left border |
| event kind | **icon**, no color | tool/LLM/prompt use different icons |
| Agent identity | **color**, but only in the compare view and overview | no brand colors inside the session view |
| data source | **text badge**, neutral gray | Scan/Proxy is metadata; shouldn't consume the color budget |

Prompt events (user_prompt / subagent_prompt) no longer use a separate hue;
instead: keep a distinct background base (very light neutral) + a bold left
bar + a dedicated icon. Their distinction need is "structural separation",
which doesn't require a new hue.

### 6.3 Dark theme

v1 has a moon button but no logic. v2 requires it to work:

- all colors become CSS variables defined in both `:root` and
  `[data-theme="dark"]`
- phase colors in dark lower brightness and raise saturation (light-theme
  phase colors on dark backgrounds are harsh)
- follow system + manual override; the choice goes to localStorage
- Gantt bars, diff highlights, and JSON syntax highlighting need individual
  contrast checks (the three most easily missed spots)

If it can't be completed short-term, **delete the moon button first**
(principle P4).

---

## 7. Design tokens

For unified reference during implementation; don't hardcode values in
components.

### 7.1 Spacing

`4 / 8 / 12 / 16 / 24 / 32 / 48` — only these seven. Card padding 16, block
gap 24, L1/L2/L3 gaps 32.

### 7.2 Font sizes and weights

| Role | Size | Weight | Use |
|------|------|--------|-----|
| display | 24 | 600 | Hero verdict, view titles |
| title | 16 | 600 | block titles, Finding titles |
| body | 14 | 400 | body text, Finding details |
| label | 12 | 500 | table headers, badges, tile labels |
| mono-data | 13 | 400 | numbers, durations, token counts |
| mono-code | 12 | 400 | commands, paths, Raw JSON, diffs |

**All numbers use monospace and right-align** — the most easily ignored yet
most directly rewarding rule for data-dense tools. Left-aligned proportional
number columns can't be compared quickly.

### 7.3 Semantic colors

```
accent        teal-600     #0d9488   primary emphasis
positive      emerald-600  #059669   winner/success
negative      rose-600     #e11d48   loser/failure
warning       amber-600    #d97706   warning
neutral       slate-500    #64748b   neutral/equal
```

Phase colors keep v1's six hue families (blue/purple/green/red/orange/pink)
but unify into 3 tiers per family: `bar` (Gantt bar) / `tint` (background) /
`text` (text).

### 7.4 Motion

Restrained; used in only three places:

- group expand/collapse: `height 160ms ease-out`
- detail panel switch: `opacity 120ms`
- Gantt zoom: `transform 200ms ease-out`

Everything else has no animation. All disabled under
`prefers-reduced-motion: reduce`.

---

## 8. Copy rules

UI text is design material, not decoration. Three hard rules:

1. **Use the user's mental words, not the system's implementation words**
   - ✅ `written before reading` ❌ `read-write ratio anomaly`
   - ✅ `repair loop` ❌ `repair_loop_detected`

2. **Action buttons say what happens, and keep the same name end to end**
   - ✅ `export report` → toast `report exported` ❌ `submit` → toast
     `operation succeeded`

3. **Empty and error states give direction, not emotion**
   - ✅ `No session selected. Pick one from the left list to start.`
   - ❌ `No data 😢`
   - ✅ `Parse failed: JSON format error at line 1420. View logs →`
   - ❌ `Failed to load, please retry later`

---

## 9. Implementation priority

Ranked by "information-hierarchy value / implementation cost". **All three P0
items only depend on existing data; no new capture capabilities needed.**

### P0 — the three things that change the tool's value

| # | Item | Section | Estimate |
|---|------|---------|----------|
| 1 | Gantt semantic collapse (incl. repair-loop detection) | §3.4 | large |
| 2 | session findings card (10 rules) | §3.1 | medium |
| 3 | compare view three-layer convergence + diff first | §5 | medium |

### P1 — significant efficiency gains

| # | Item | Section |
|---|------|---------|
| 4 | global search ⌘K | §2.2 |
| 5 | time composition bar (model/tool/idle/wait) | §3.2 |
| 6 | draggable detail panel + full-screen drawer + local search | §3.5 |
| 7 | keyboard navigation | §3.4.3 |
| 8 | clean up placeholder controls (delete or implement) | §0-P4 |
| 9 | ContextBar scrolling context | §2.1 |

### P2 — experience completion

| # | Item | Section |
|---|------|---------|
| 10 | relative/absolute time toggle | §3.4.4 |
| 11 | Gantt range zoom | §3.4.4 |
| 12 | dark theme | §6.3 |
| 13 | color system convergence | §6.2 |
| 14 | virtual scrolling | §3.4.5 |
| 15 | Agent overview sorting and quick compare | §4 |

---

## 10. Acceptance criteria

After implementation:

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | a 500-event session, first-screen visible rows after semantic collapse <= 80 | count on one real long session |
| 2 | opening any session, within 3s you can say "where the time went, whether there are problems" | test with a colleague who hasn't used it |
| 3 | compare view first screen (no scroll) reveals the winner and the main gaps | screenshot check |
| 4 | no control on the UI that does nothing on click | click through the control checklist |
| 5 | 2,000-event session scroll frame rate >= 50fps | Performance panel |
| 6 | full keyboard flow: select session → browse events → view detail → export | complete once without the mouse |
| 7 | dark-theme diff / JSON highlight / Gantt bar contrast >= 4.5:1 | contrast checker |
| 8 | every Finding clickable and locating the matching event | click each one |

---

## Appendix: difference summary vs v1

| v1 | v2 |
|----|----|
| flat data display | three-layer convergence (conclusion/dimension/detail) |
| user draws conclusions | findings card gives conclusions directly |
| events listed one by one | semantic grouping and collapse |
| time colored only by phase | adds execution-semantics split (model/tool/idle/wait) |
| compare verdict at the end | verdict moved to the first screen |
| all 19 metric rows shown | < 10% differences collapsed by default |
| 4 charts | 2 (radar + stacked bars); others removed or collapsed |
| 28 colors on one screen | one channel one dimension; color only encodes phase and Agent |
| several placeholder buttons | implemented or deleted |
| no search | global ⌘K + prefix filters |
| mouse-driven | full keyboard usable |
