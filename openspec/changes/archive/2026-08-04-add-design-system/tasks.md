> Detailed acceptance criteria: `UI-TASKS.md` T-13 / T-14. Values always per
> `contracts/design-tokens.md`. Strictly sequential: token → icons →
> components (design.md D5).

## 1. Token layer and theme mechanism (T-13, spec REQ-001/002/003)

- [x] 1.1 create `src/styles/tokens.css` landing all contract §2-§7 variables
  for both themes (key sets must be exactly equal)
- [x] 1.2 split `src/styles.css` → `base.css` / `layout.css` /
  `components.css`; `main.tsx` imports in tokens→base→layout→components order
- [x] 1.3 add the **inline sync** theme script to `index.html`, setting
  `data-theme` before first-paint CSS (D2 / G-DS-2)
- [x] 1.4 implement three-state theme toggle + localStorage
  `agent-observability.theme` + `matchMedia` change listener
- [x] 1.5 replace all existing hardcoded hex with `var(--*)`
- [x] 1.6 write `src/styles/tokens.test.ts`: contract §9 **T1** (key sets
  equal), **T2** (no literal colors), **T3** (no literal spacing)
- [x] 1.7 write contrast assertions **T4** (WCAG relative luminance, computed
  by hand, no library) and **T5** (6 phase colors pairwise ΔE > 15)
- [x] 1.8 acceptance: theme switch without reload or flash; theme persists
  after refresh; CSS gzip < 16KB

## 2. Icon set (T-14, spec REQ-004)

- [x] 2.1 create `src/components/icons/index.tsx` with a shared `<Icon>` shell
  (`size` / `className` / `label`)
- [x] 2.2 implement 8 nav/view icons: Sessions / Agents / Compare / Proxy /
  Frida / Sidebar / Panel / Command
- [x] 2.3 implement 6 phase icons: Understand / Plan / Implement / Debug /
  Verify / Report
- [x] 2.4 implement 6 status icons: Success / Error / Running / Pending /
  Cancelled / Warning
- [x] 2.5 implement 6 event-kind icons: Message / Tool / File / Terminal /
  Thought / System
- [x] 2.6 implement 4 metric icons: Speed / Accuracy / Stability / Cost
- [x] 2.7 implement 12 action icons: Search / Filter / Refresh / Copy /
  Download / ExternalLink / Trash / Close / ChevronRight / ChevronDown /
  Kebab / Plus
- [x] 2.8 implement 5 other icons: Gear / Globe / Sun / Moon / DeviceDesktop
  (the three theme icons independent, no path reuse)
- [x] 2.9 write assertions **T6** (export name set exactly equals the list,
  no more no less = 47) and **T7** (contains `viewBox="0 0 16 16"`, no
  `fill="#"`/`stroke="#"`)
- [x] 2.10 acceptance: full set uncompressed < 12KB

## 3. Base component library (spec REQ-005)

- [x] 3.1 Button / IconButton (variant × size, hit target >= 24×24)
- [x] 3.2 Badge / StatusBadge / PhaseBadge / ProviderBadge (monogram, colors
  per contract §2.6)
- [x] 3.3 Field / Input / Select / SearchInput (same height as Button, `/`
  focus)
- [x] 3.4 Tabs (underline / pill) / Table (compact density, sticky header,
  sortable)
- [x] 3.5 Tooltip / Popover / DropdownMenu (Esc close, outside click close,
  focus return; hand-written, no library)
- [x] 3.6 Modal / Drawer (focus trap)
- [x] 3.7 Kbd / MetricCard / BarMeter / Sparkline (inline SVG)
- [x] 3.8 SplitPane (drag + width persistence)
- [x] 3.9 acceptance: every interactive element has a `:focus-visible` focus
  ring; animations go to zero under `prefers-reduced-motion`

## 4. Wrap-up

- [x] 4.1 `npm run typecheck && npm run test && npm run lint` all green
- [x] 4.2 all seven contract §9 assertions T1-T7 run in CI and pass
- [x] 4.3 update `PROGRESS.md`
- [x] 4.4 `openspec archive add-design-system`
