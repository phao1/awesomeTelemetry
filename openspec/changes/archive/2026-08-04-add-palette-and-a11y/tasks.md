> Detailed acceptance criteria: `UI-TASKS.md` T-23 / T-24.
> Prerequisite: `redesign-frontend-views` archived.

## 1. Shortcut dispatch (design-system REQ-008)

- [x] 1.1 single global `keydown` listener + mapping table (D1)
- [x] 1.2 when an input is focused or `isComposing`, only Esc passes (IME-safe)
- [x] 1.3 implement: `1`-`5` switch views / `/` focus search / `j`·`k` browse /
  `Enter` open / `[`·`]` collapse rails / `⌘\` toggle theme
- [x] 1.4 overlay stack + `Esc` closes by layer (D2)
- [x] 1.5 `?` keyboard help overlay (content via i18n)

## 2. Command palette (frontend REQ-025)

- [x] 2.1 `CommandPalette` component: `Modal` shell + search input + virtualized
  results
- [x] 2.2 `import()` lazy-load on first `⌘K` (D4)
- [x] 2.3 commands: jump to session (fuzzy match title/id), switch views,
  toggle theme, toggle language, trigger scan, open settings
- [x] 2.4 reuse the shared session store, **issue no requests**
- [x] 2.5 first-screen discovery hint line (`⌘K search sessions · ?
  shortcuts`), hidden after first use
- [x] 2.6 acceptance: first screen does not instantiate the palette or prefetch
  the full list

## 3. URL hash state sync (frontend REQ-024)

- [x] 3.1 hand-written parse/serialize module (**within 60 lines**, no router
  library)
- [x] 3.2 support `#/sessions?key=…&phase=…&provider=…`, `#/agents`,
  `#/compare?left=…&right=…`
- [x] 3.3 one-way data flow: state change writes hash; `hashchange` parses and
  applies (D3, no loops)
- [x] 3.4 dirty hash falls back to the default view without throwing
- [x] 3.5 acceptance: `#/compare?left=…&right=…` state persists after refresh

## 4. a11y close-out (design-system REQ-009)

- [x] 4.1 semantic roles: tabs `role="tablist"`, lists
  `role="listbox"`+`aria-selected`, modals `role="dialog"`+`aria-modal`
- [x] 4.2 focus: overlay focus trap; focus returns to the trigger on close
- [x] 4.3 `aria-live="polite"`: status-bar connection indicator and Toasts
- [x] 4.4 acceptance: 200% zoom no horizontal scroll, no content truncation
- [x] 4.5 acceptance: keyboard completes "open session → select event → view
  Raw → close"
- [x] 4.6 acceptance: `prefers-reduced-motion` zeroes animations; skeleton
  shimmer and running pulse stop

## 5. i18n and contract-assertion close-out

- [x] 5.1 all new keys complete in zh + en (`i18n.test.ts` key-alignment
  assertion must stay green)
- [x] 5.2 all seven `contracts/design-tokens.md` §9 assertions T1-T7 run in CI
- [x] 5.3 end-to-end smoke: start → `GET /` 200 → first list title not a file
  name → open has events → switch 5 views with no console errors
- [x] 5.4 record the smoke test's port-listening requirement in `RUNBOOK.md`

## 6. Wrap-up

- [x] 6.1 `npm run typecheck && npm run test && npm run lint &&
  npm run perf:check` all green
- [x] 6.2 first-screen performance measured (NEXT-TASKS.md T-07 leftover),
  results appended to `PERF-BASELINE.md`; record honestly if not met
- [x] 6.3 update `PROGRESS.md`
- [x] 6.4 `openspec archive add-palette-and-a11y`
