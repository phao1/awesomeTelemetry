# Adapters (delta)

## ADDED Requirements

### Requirement: Duration derivation & model attribution
Adapters whose source lacks real event durations MUST run `deriveDurations()`
and label the session `durationSource: 'derived'`; sources with real span
durations keep `'measured'`. The choice follows the actual parse path, never a
per-provider hardcode. Every adapter MUST populate `TraceEventSlim.model` for
llm events when the source carries a model id and leave it `null` otherwise;
sessions get `primaryModel` from `pickPrimaryModel(events)`. The produced
`duration_source` / `primary_model` / `cost_source` MUST be persisted by the
storage layer, never dropped.

#### Scenario: claude fixture model attribution
- **GIVEN** a claude fixture whose llm messages carry `model`
- **WHEN** the adapter parses it
- **THEN** llm events have `model` set and the session has a non-null
  `primaryModel`

#### Scenario: provider without model data
- **GIVEN** a provider whose source rows have no model field
- **THEN** llm events get `model: null` and `primaryModel: null`
- **AND** the pipeline must not throw or fabricate a model
