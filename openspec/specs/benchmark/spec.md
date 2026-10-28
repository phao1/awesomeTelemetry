# Task benchmarking

Implement benchmark.md BENCH-001..004. This post-M12 module adds an execution
and evaluation workflow beside native observability and manual experiments.

- REQ-001: identical pinned source/prompt/evaluator for isolated variant runs.
- REQ-002: bounded external GUI driver protocol, actual-model evidence and
  independent acceptance; failure, timeout, cancellation and unknown distinct.
- REQ-003: explicit usage inclusion, measured timing, unknown-safe full metric
  matrix and repeated-run statistics; no causal winner without evidence.
- REQ-004: deterministic diagnosis links to run/span, optimization hypothesis and
  verification; clear partial/sample/mismatch limitations.
- REQ-005: lazy bilingual benchmark center with report/manifest import/export,
  synthetic preview, shared relative-time lanes and exact original navigation.
- REQ-006: user-confirmed example scope: structured product/model/repetition
  form and explicit fixed local task execution per BENCH-005; real independent
  acceptance, immediate report handoff, cancellation and no vendor invocation.

Gotchas: G4.1/G4.4/G4.5/G4.6 (timing/usage), G7.1/G7.3/G7.6 (inspection/bounds),
G11.6/G11.9 (async/no fan-out). No additional runtime dependency or DB migration.
Acceptance: actual child-process/temp-Git runner tests, accounting/validation
tests, component tests, typecheck/lint/build, full regression and browser review.
