> Detailed acceptance criteria: `UI-TASKS.md` T-15 through T-22.
> Prerequisites: `fix-session-data-integrity` and `add-design-system` both
> archived. **One commit per view** (design.md D6).

## 1. Shared session store, fix compare view (T-15, spec REQ-015)

- [x] 1.1 write tests: render App, load 3 sessions, switch to compare, assert
  both pickers have 3 options each
- [x] 1.2 move the session index up to sole ownership in `App.tsx`; delete
  `SampleRail`'s private `sessions` state
- [x] 1.3 `SessionList` becomes a controlled component (items / pagination
  callbacks via props)
- [x] 1.4 SSE patches, scroll pagination, and compare pickers all read the
  same source (G7.6: no second session array)
- [x] 1.5 acceptance: after startup click compare directly; both pickers
  populated; selecting two produces results

## 2. Four states and eliminating empty catches (T-16, design-system REQ-006
+ frontend REQ-022)

- [x] 2.1 implement `Skeleton` / `EmptyState` / `ErrorState` / `Toast`
- [x] 2.2 refactor one by one per the 7-row table in
  `specs/frontend/spec.md` REQ-022 (SessionList / selectSession /
  EventInspector / AgentOverview / CompareBoard / Proxy+Frida / SettingsModal)
- [x] 2.3 all `catch` blocks: set error state + `console.error` the original
  error; **must not be empty or comment-only**
- [x] 2.4 add CI assertion: no empty `catch {}` or comment-only catch in
  `src/**/*.tsx`
- [x] 2.5 i18n adds `state.*` prefix copy (zh + en together; `i18n.test.ts`
  has key-alignment assertions)
- [x] 2.6 acceptance: kill the backend, click any session; error code +
  retry button appears within 5s; status bar turns disconnected
- [x] 2.7 acceptance: loading skeleton row height == real row height; CLS = 0
  when data arrives

## 3. AppShell + status bar + layout persistence (T-17, spec REQ-015/023/026)

- [x] 3.1 global header 48px + underline tabs 40px + three columns + status
  bar 28px
- [x] 3.2 left/right rail drag-resize (rail 260-480, inspector 280-900) and
  collapse
- [x] 3.3 status bar: connection (`aria-live`) / session+event counts / scan
  state / DB size / data-source marker
- [x] 3.4 layout preference persistence (REQ-026's 7 keys) with range checks
  on read
- [x] 3.5 acceptance: status bar does **not poll** `/api/health`; dirty
  localStorage values don't crash

## 4. Session list rows (T-18, spec REQ-016)

- [x] 4.1 44px two-line dense: status dot + title / ProviderBadge + relative
  time + events + tokens
- [x] 4.2 selected state 2px left bar; hover without transition (G-DS-4)
- [x] 4.3 filter area: SearchInput + provider multi-select + status
  multi-select
- [x] 4.4 acceptance: 500-session scroll dropped frames < 5%; row height
  constant `--row-lg` (G-DS-1)

## 5. Session detail main area (T-19, spec REQ-017)

- [x] 5.1 SessionHeaderCard: provider + title + status + overflow menu + meta
  row
- [x] 5.2 four-dimension metric strip (Speed/Accuracy/Stability/Cost); `null`
  shows `—` with tooltip, **never `0` as a stand-in**
- [x] 5.3 **PhaseRibbon**: color band spanning width by time share; hover
  shows phase/duration/event count; click equals selecting only that phase
- [x] 5.4 PhaseTiles: 6 tiles with count badges + select all / deselect all
- [x] 5.5 TraceTimeline: time-proportional bar (real position and duration) +
  tree indentation (max 3 levels, collapsible) + phase icon and color
- [x] 5.6 zero-duration events render as minimum 2px vertical lines
- [x] 5.7 EventInspector tabs (Summary/Input/Output/Raw/Tokens); **Raw
  fetches only when switched to**
- [x] 5.8 fix P1-6: Transcript switches to paginated fetch + virtual scroll
  inside the modal, **never one `mode=full`**
- [x] 5.9 acceptance: 9,590-event session DOM < 500, first paint < 200ms

## 6. Agent overview (T-20, spec REQ-018)

- [x] 6.1 top 4 KPI cards (Speed/Accuracy/Stability/Cost weighted aggregates)
- [x] 6.2 sortable compare table + inline BarMeter / Sparkline; numeric
  columns right-aligned mono
- [x] 6.3 `null` and `0` visually distinguishable
- [x] 6.4 row expansion lists the provider's 10 most recent sessions; click
  jumps and selects
- [x] 6.5 acceptance: switching to this view issues **== 1** request; expanded
  rows produce no new requests (G11.9)

## 7. Compare view (T-21, spec REQ-019)

- [x] 7.1 search-style session pickers (Popover + search, **no native select**)
- [x] 7.2 **verdict strip**: one sentence stating "who is faster by how much /
  who saves how much"
- [x] 7.3 four-dimension double bars, colored by "who is better"; L/R must
  carry letter markers beyond color
- [x] 7.4 PhaseRibbon top/bottom comparison (shared time scale) + side-by-side
  timelines
- [x] 7.5 empty-state guidance when nothing selected, not two empty dropdowns

## 8. Proxy / Frida views (T-22, spec REQ-020/021)

- [x] 8.1 Proxy control strip: status / start-stop / port / CA cert download /
  request count and clear
- [x] 8.2 stop and clear are destructive; need confirmation (design-system
  REQ-007)
- [x] 8.3 dense request table + method color badges + semantic status colors +
  filters
- [x] 8.4 detail drawer: Request / Response / Headers / Timing tabs,
  desensitized fields marked
- [x] 8.5 Frida control strip + capture list + prerequisites-not-met state
  explaining what's missing and how to install
- [x] 8.6 acceptance: not-started empty state contains a start button and CA
  install hint, not just "no data"

## 9. Wrap-up

- [x] 9.1 `npm run typecheck && npm run test && npm run lint` all green
- [x] 9.2 walk through all five views manually, no console errors
- [x] 9.3 update `PROGRESS.md`
- [x] 9.4 `openspec archive redesign-frontend-views`
