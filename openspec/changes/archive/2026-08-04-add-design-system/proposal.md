## Why

The current `src/styles.css` is only 72 lines with 30+ hardcoded hex values,
zero CSS variables, and zero icons. This is not an aesthetic issue but a
structural one: **without a token layer, dark mode cannot be added**; without
base components, every view writes its own buttons and tables.

The product positioning is "the agent observability tool developers most want
to open", modeled on GitHub / Linear / Grafana. Before drawing any page, there
must be a themeable token layer and a unified set of atomic components.

## What Changes

- Split `src/styles.css` → `src/styles/{tokens,base,layout,components}.css`,
  landing all dual-theme variables from `contracts/design-tokens.md`.
- Three-state theme (system / dark / light) + localStorage persistence +
  inline sync script in `index.html` to prevent first-frame flash.
- Replace all hardcoded hex values with `var(--*)`, with CI assertions
  forbidding regression.
- Add 47 hand-written inline SVG icons (16×16 grid, `currentColor`,
  **zero dependencies**).
- Add the `src/components/ui/` base component library (Button / Badge / Table
  / Modal / Tooltip etc., 25 items).

No BREAKING: pure additions and style refactor; no API or data structure
changes.

## Capabilities

### New Capabilities

No new spec file needed — `specs/design-system/spec.md` landed on 2026-08-04.

### Modified Capabilities

No deltas. This change implements `specs/design-system/spec.md` REQ-001~005,
REQ-010 and the full `contracts/design-tokens.md`; the specs were already in
place, so `.openspec.yaml` sets `skip_specs: true`.

## Impact

| Area | Impact |
|------|--------|
| Code | `src/styles.css` deleted and split; `index.html` gains an inline theme script; new `src/components/icons/`, `src/components/ui/` |
| Existing components | all components' classNames and inline styles switch to token references; logic and props unchanged |
| Tests | new `src/styles/tokens.test.ts` (contract §9 T1-T7 assertions) |
| Dependencies | **0 new**. Icons, tooltip, and drag all hand-written (AUTOPILOT prohibition C) |
| Performance | CSS gzip < 16KB, icon set < 12KB, theme switch < 16ms |
