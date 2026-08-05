## Why

The previous three changes made the product usable and good-looking, but not
yet "handy". A developer tool's handiness shows in two places: **keyboard
without leaving the keys** (⌘K jump, j/k browsing, number keys switch views)
and **shareable state** (send a URL to a colleague; opening it lands on the
same session with the same filters).

At the same time, a11y and the contract assertions need to be closed out
here — the seven assertions of `contracts/design-tokens.md` §9 and the
accessibility requirements of `specs/design-system/spec.md` REQ-009 should be
accepted once features are complete, avoiding rework inside the previous
three changes.

## What Changes

- Command palette (⌘K): jump to session, switch views, toggle theme/language,
  trigger scan, open settings; lazy-loaded, virtualized results, reuses the
  shared store with no requests.
- Full shortcut set: `1`-`5` switch views, `/` focus search, `j`/`k` browse,
  `Enter` open, `Esc` close, `[`/`]` collapse rails, `⌘\` toggle theme, `?`
  help.
- URL hash state sync: view, selected session, and filters shareable and
  refresh-persistent (hand-written within 60 lines, no router library).
- a11y close-out: focus management, semantic roles, `aria-live`, 200% zoom,
  `prefers-reduced-motion`.
- i18n completion, the seven contract assertions in CI, plus one end-to-end
  smoke test.

No BREAKING.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

No deltas. This change implements `specs/frontend/spec.md` REQ-024/025 and
`specs/design-system/spec.md` REQ-008/009; the specs already landed, so
`skip_specs: true`.

## Impact

| Area | Impact |
|------|--------|
| Code | new `CommandPalette` (lazy), shortcut hook, hash-route module; aria attributes across views |
| Dependencies | depends on `redesign-frontend-views`. **0 new deps** — no router lib, no shortcut lib |
| Tests | new end-to-end smoke: start → `GET /` 200 → first title not a file name → open has events → switch 5 views with no console errors |
| Performance | palette must not slow first screen: instantiated only on the first ⌘K, no full-list prefetch |
