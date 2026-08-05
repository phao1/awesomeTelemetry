# OpenSpec — Agent Observability spec v5

This directory is the project spec written in the
[OpenSpec](https://github.com/Fission-AI/OpenSpec) format.

**This is a fresh 0-1 build**: no historical data migration, schema starts at
v1, no compatibility baggage. The goal is to recreate the full capability of
the reference implementation while avoiding every pitfall it hit from the first
line of code.

> Every "reference implementation" mentioned below is the pre-existing project
> this one was rebuilt from. Numbers quoted as measured describe what the
> project would grow into **without these constraints** — not the current state
> of this project.

## Three changes vs the reference spec

1. **New `contracts/` directory** — four contracts for types, DDL, API, and
   performance budget. This was the biggest gap in v4: v4 REQs only said "MUST
   contain id, kind, phase" without types, nullability, or the full enum set,
   so 9 adapters each invented their own fields during codegen.
2. **Performance is a hard requirement** — v4 had zero performance
   requirements, and the resulting system took 5.9-12.4s for first screen. v5's
   `contracts/nfr.md` writes the budget as verifiable assertions that run in CI.
3. **Gotchas gain a chapter 11** — 19 performance gotchas, all backed by
   measured numbers. Two v4 conclusions (G5.3 metrics not persisted, G10.1
   prewarm non-blocking) were overturned by measurements and annotated in place.

## Directory layout

```
openspec/
├── README.md                    ← you are here
├── project.md                   ← project overview, tech stack, architecture, conventions
├── gotchas.md                   ← ⚠️ full gotcha list (chapter 11 = performance, must read)
├── contracts/                   ← ⚠️ authoritative codegen input; wins on conflict
│   ├── data-model.md            ← complete TypeScript types + full enum set
│   ├── database.md              ← complete SQL DDL v1 + indexes + PRAGMAs
│   ├── api.md                   ← complete HTTP API contract + error envelope + contract tests
│   ├── nfr.md                   ← performance budget + CI assertions + scale-up signals
│   └── design-tokens.md         ← palette / type scale / spacing / icon spec + contrast assertions
└── specs/
    ├── trace-model/             ← data model behavior requirements
    ├── storage/                 ← SQLite storage behavior requirements
    ├── session-scanning/        ← scanners + incremental gate + prewarm strategy
    ├── adapters/                ← 9 provider adapters
    ├── realtime/                ← EventBus + event coalescing + SSE
    ├── design-system/           ← visual atoms (tokens / icons / components / states / shortcuts)
    ├── frontend/                ← React SPA (5 views + virtual scrolling + layout)
    ├── desensitization/         ← PII desensitization engine
    ├── metrics-analysis/        ← phase classification + four-dimension metrics + reports
    ├── proxy-capture/           ← MITM + CDP + Frida
    ├── trae-decryption/         ← ⚠️ Trae CN three-layer decryption (most time-consuming reverse engineering)
    ├── session-merge/           ← session merging
    └── cli-build/               ← CLI + three-stage build + scripts
```

## How to use this spec to rebuild

### Step 0: read the four files
In order: `contracts/data-model.md` → `contracts/database.md` → `contracts/nfr.md`
→ `gotchas.md` chapter 11. The first two decide whether the code you write
composes; the last two decide whether it runs fast enough.

**Development flow and prompts live in `BOOTSTRAP.md` and `PROMPTS.md` at the
repo root.**

### Step 1: implement in dependency order

| Stage | Module | Depends on | Key contracts |
|-------|--------|-----------|---------------|
| 1 | trace-model | none | `contracts/data-model.md` in full |
| 2 | storage | 1 | `contracts/database.md` in full |
| 3 | session-scanning | 2 | nfr §3 startup behavior |
| 4 | adapters | 1 | data-model §2 token semantics |
| 5 | realtime | 2 | data-model §10 BusEvents |
| 6 | design-system | — | `contracts/design-tokens.md` in full |
| 6 | frontend shell | 1,5,6 | `contracts/api.md` §1-3 + `contracts/design-tokens.md` |
| 7 | desensitization | none | — |
| 8 | proxy-capture | 2,5,7 | api §4 |
| 9 | metrics-analysis | 1 | data-model §6 |
| 10 | session-merge | 2 | — |
| 11 | trae-decryption | 3,8 | specs/trae-decryption in full |
| 12 | cli-build | all | api §0 + nfr §5 |

Per-milestone file lists and acceptance criteria are in `BOOTSTRAP.md`.

### Step 2: run performance assertions after every module merge
The `contracts/nfr.md` §5 assertions must run in CI. They lock down the points
most easily broken unintentionally.

### Structure of every spec
- **Purpose** — what this module does
- **Requirements** — numbered `REQ-XXX` behavior requirements + `Scenario`
  (GIVEN/WHEN/THEN verifiable examples)
- **Gotchas** — module-specific pitfalls, pointing to the matching entry in
  `gotchas.md`

## The 8 most common pitfalls (read before rebuilding)

| # | Entry | One-liner |
|---|-------|-----------|
| 1 | **G11.5** | `scan_state` writes must throw, not fail silently, otherwise incremental scanning is fake and completely silent |
| 2 | **G11.9** | any frontend `sessions.map(s => fetch(...))` is a design error; add a server-side aggregation endpoint |
| 3 | **G11.1** | detail endpoint defaults to slim, no raw or body, otherwise the worst session response is 32MB |
| 4 | **G11.6** | `spawnSync` is forbidden in single-threaded Node; one call eats 1.5-2.3s of the event loop |
| 5 | **G4.4** | OpenCode/CodeArts cache.read is per-step incremental, use sum (calibrated 2026-08-03), reasoning uses sum |
| 6 | **G11.15** | WAL-source change fingerprints must cover the `-wal` file; watching only the main DB never detects changes |
| 7 | **G11.4** | `WHERE x=? ORDER BY y` needs a `(x,y)` composite index; a single-column index forces a temp sort |
| 8 | **G3.1** | dev URLs must be `127.0.0.1`, not `localhost` (Huawei proxy ProxyOverride) |

## Performance triage methodology

If the rebuilt system is still slow, **do not optimize by intuition**. Follow
the 7-step process in `PERF-DIAGNOSIS.md`:

1. data-size baseline → 2. index & query plan → 3. server-side segment timing →
4. **A/B experiments** → 5. CPU profile → 6. frontend waterfall → 7. write
amplification

Step 4 gives the most information per unit cost: disable a suspect component
and compare before/after. This project found its root cause that way in one
step (ratio 1240x); jumping straight to SQL optimization would have spent all
time on the 4.2% CPU slice.

## Trae decryption deep-dive

Trae CN's three-layer encryption (SQLCipher DB + TTNet network + client-
assembled prompt) is the most time-consuming reverse-engineering in this
project. The full chain is in `specs/trae-decryption/spec.md`, including the
list of proven-dead approaches (**do not retry anything already verified to
produce 0 events**). v5 only changed how it is **invoked** (async spawn +
result cache + moved off the request path); the decryption logic itself is
unchanged.

## Relationship to the OpenSpec tooling

This directory follows the `specs/<domain>/spec.md` convention (Requirements +
Scenarios). `project.md`, `gotchas.md`, and `contracts/` are three extra
replica-oriented document types and the core of how this differs from a plain
OpenSpec spec.

**About `changes/`**: the M0-M12 rebuild phase did not use it (the goal was
"replicate an existing project" rather than "manage changes"; specs were
written directly into `specs/`). It has been active since the 2026-08-04 UI
design refresh for execution tracking: `openspec list` for progress,
`openspec status --change <id>` for a single change's artifact completion.

The four current changes already landed their specs into the main `specs/`
(`design-system`, `frontend` REQ-015+, `session-scanning` REQ-021/022,
`contracts/design-tokens.md`), so their `.openspec.yaml` set `skip_specs: true`
and only carry proposal / design / tasks artifacts.
**New requirements start the full flow**: `openspec new change` → proposal →
spec delta → design → tasks → implement → `openspec archive`.

```bash
openspec list                              # view all changes and task progress
openspec status --change <id>              # view one change's artifact completion
openspec validate <id> --strict            # validate before commit
openspec archive <id>                      # archive when done (merges deltas into main specs)
```

To manage with the OpenSpec CLI: `npm install -g @fission-ai/openspec` →
`openspec list`.
