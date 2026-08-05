## Context

The zero-dependency constraint means the command palette, shortcut dispatch,
and hash routing are all hand-written. The good news: none of the three is
complex — the palette reuses existing `Modal` + `VirtualList` + search
matching; shortcuts are one `keydown` listener + a mapping table; hash routing
is a thin `URLSearchParams` wrapper.

The hard part is **conflict handling**: focused inputs must not be hijacked by
`j`/`k`, and `Esc` must close overlays by layer.

## Goals / Non-Goals

**Goals:**
- keyboard completes the whole "open session → select event → view Raw →
  close" flow
- URLs shareable and refresh-persistent
- all seven contract assertions and a11y requirements gated in CI

**Non-Goals:**
- no full-text search (the palette only fuzzy-matches loaded sessions by
  title/id)
- no full browser back/forward history stack (hash change is the state; no
  extra stack entries)
- no multi-language expansion (still zh/en only)

## Decisions

**D1 · Shortcuts use one global `keydown` listener + mapping table; no
per-component listeners.**
Scattered listeners produce unpredictable conflicts and memory leaks. A
single entry point makes global rules like "only Esc works when an input is
focused" easy.

**D2 · `Esc` closes one overlay layer at a time, not all at once.**
Maintain an overlay stack (palette > modal > drawer > popover); Esc closes
only the top. This matches users' existing expectations for overlays.

**D3 · Hash is the single representation of state; no two-way diff.**
State change → write hash; `hashchange` → parse and apply. No "who changed
first" arbitration, avoiding trigger loops; hash writes use `replaceState`
semantics to avoid polluting history.

**D4 · The command palette lazy-loads; `import()` only on the first ⌘K.**
The palette depends on virtual scrolling and matching logic; putting it in the
first-screen chunk isn't worth it (REQ-025 requires this explicitly).

**D5 · a11y and the contract assertions are done last, all at once.**
Doing them incrementally inside the previous three changes would cause
repeated rework — adjusting focus order while layout is still changing is
wasted effort. Once features are stable, close out in one pass at the lowest
cost.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| shortcuts conflict with browser/IME (e.g. `/` under Chinese input) | when an input is focused or `isComposing`, pass everything through except Esc |
| dirty hash values crash parsing | parse failure falls back to the default view without throwing (same range-check idea as REQ-026) |
| the a11y close-out reveals layout changes are needed | this is D5's known cost; if layout must change, record D-### per AUTOPILOT §3 |
| 200% zoom exposes fixed-width problems | the three rails are already draggable; collapse breakpoints as fallback |
| end-to-end smoke needs a real port listener | follow T-06's conclusion: CI must allow 127.0.0.1, or tag these tests to run separately (record in RUNBOOK) |
