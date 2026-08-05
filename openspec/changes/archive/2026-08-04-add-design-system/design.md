## Context

`contracts/design-tokens.md` already fixes the palette, type scale, spacing,
motion, and contrast; this change only lands them. The only freedom is in
**organization**: CSS variables vs CSS-in-JS, how icons are packaged, how thin
the component library is.

Hard constraint: zero new dependencies (`project.md` §2 keeps only 4 runtime
deps deliberately). This rules out Tailwind / styled-components / lucide /
radix and every other off-the-shelf solution.

## Goals / Non-Goals

**Goals:**
- tokens themeable, and "regressing to hardcoded values" turns CI red
- no first-frame flash
- 47 icons + 25 components, all hand-written, tree-shakeable, controlled
  total size

**Non-Goals:**
- no Storybook / docs site for components
- no pixel-perfect design mockup — the contract gives tokens, not mockups
- no view layout changes in this change (that's `redesign-frontend-views`)

## Decisions

**D1 · Plain CSS variables + regular classes, no CSS solution at all.**
The alternative CSS Modules was rejected: Vite supports it by default but
makes class names unpredictable, and the contract §9 T2/T3 assertions need
static scanning of CSS files. Plain CSS + variables is the most testable.

**D2 · The theme script is inline in `index.html`'s `<head>`, not in the
bundle.**
In the bundle it runs after first-paint CSS and always flashes (G-DS-2). The
cost is a small piece of raw JS in `index.html` — acceptable; this is the
standard approach for every dark-mode solution.

**D3 · Icons are individually named exports, no `<Icon name="x">` string
mapping.**
String mapping would pull all 47 icons into any chunk that references it.
Named exports tree-shake, and the T6 assertion can statically validate the
export-name set.

**D4 · The component library only does "pure presentational pieces with no
business logic".**
Data fetching and four-state decisions stay in the view layer. That keeps
components testable and reusable, and prevents couplings like "a fetch hidden
inside a Button".

**D5 · Strictly sequential: tokens → icons → components.**
Components depend on tokens and icons; parallel work would produce massive
rework.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| hand-writing 47 icons is slow and easy to deform | unified 16×16 grid + shared `<Icon>` shell; T7 asserts viewBox and no hardcoded colors |
| replacing all hardcoded hex may miss some | T2/T3 assertions are full static scans; a miss turns red |
| contrast below contract §2.7 | T4 computes with the WCAG relative-luminance formula (no library); adjust token values, never assertions |
| the 6 phase colors may be insufficiently distinguishable (cyan/blue close) | T5 asserts pairwise ΔE > 15; color never carries meaning alone, always paired with icons |
| CSS size over budget | gzip < 16KB budget in CI; cut unused component variants first |
