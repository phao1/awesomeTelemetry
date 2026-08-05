# Design System (delta)

## MODIFIED Requirements

### Requirement: Accent color tokens
The `accent` token group SHALL carry the AwesomeTelemetry brand teal in both themes.
`contracts/design-tokens.md` §2.2 MUST be updated in the same commit — the contract
is the authoritative codegen input (AGENTS.md priority tier 1), and leaving it on the
old blue guarantees the next contributor writes the blue back.

| Token | dark (`:root`, canvas `#0d1117`) | light (`[data-theme="light"]`, canvas `#ffffff`) |
|---|---|---|
| `--accent-fg` | `#2dd4bf` (contrast 10.17) | `#0f766e` (contrast 5.47) |
| `--accent-emphasis` | `#0f766e` (white-on 5.47) | `#0f766e` (white-on 5.47) |
| `--accent-subtle` | `rgba(45, 212, 191, 0.15)` | `rgba(15, 118, 110, 0.1)` |

Contrast figures above were computed with the same WCAG relative-luminance formula
used by `src/styles/tokens.test.ts`; all four combinations clear the 4.5 threshold
required by §2.7.

`--phase-implement` MUST NOT change: it is governed by assertion T5 (six phase colors
pairwise ΔE > 15), and changing it forces recomputing 15 pairs. `accent` is not a
phase color and does not participate in T5.

`--seg-model` MUST NOT change in this change: measured ΔE against the new accent is
45.1 (dark) and 39.7 (light), both far above this project's 15 distinguishability
threshold.

#### Scenario: contrast assertions still pass
- **GIVEN** the teal accent tokens above
- **WHEN** `src/styles/tokens.test.ts` runs
- **THEN** T1 (key parity), T4 (all §2.7 contrast combinations, both themes), and T5
  (phase ΔE) all pass unchanged

## ADDED Requirements

### Requirement: Application favicon
The application SHALL ship `public/favicon.svg` — a teal rounded square with a WiFi
ripple mark — referenced from `index.html` via
`<link rel="icon" type="image/svg+xml">`. Hand-written SVG only; no runtime
dependency and no raster asset.

Literal hex colors are permitted in the SVG: assertion T2 (no literal hex outside
`tokens.css`) scans `src/styles/**/*.css` only.

#### Scenario: favicon is self-contained
- **GIVEN** a production build
- **THEN** the favicon resolves from the app's own origin with no external request

### Requirement: Brand identity
The product name SHALL be **AwesomeTelemetry** across the page title, CLI banner,
report footers, and i18n strings, together with the package name
(`awesome-telemetry`), the `awesome-telemetry` bin entry, the
`awesome-telemetry-data` directory, and the `awesome-telemetry.theme` localStorage
key.

Two backward-compatibility fallbacks are **acceptance criteria, not optional
polish**:

1. **Data directory** — when the new directory is absent and the old
   `agent-observe-data` exists, keep using the old one and print a notice. Do not
   auto-migrate, and do not silently create an empty database: users would read that
   as months of scan history having vanished.
2. **localStorage** — the inline theme script reads the new key, falls back to the
   old key, and writes the new key on a successful fallback read. This script runs
   synchronously before any CSS (G-DS-2), so the change MUST be verified in a real
   browser for absence of a flash of unstyled content.

#### Scenario: existing user keeps their data and theme
- **GIVEN** an installation with `agent-observe-data/observe.sqlite` and
  `localStorage['agent-observability.theme'] = 'light'`
- **WHEN** the renamed build starts
- **THEN** the existing database is used and the light theme is applied with no
  flash, and the new localStorage key is written
