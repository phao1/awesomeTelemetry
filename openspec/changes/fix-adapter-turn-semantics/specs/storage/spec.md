## ADDED Requirements

### Requirement: Turn key persistence

Storage SHALL persist `turn_key` on events, return it in every event projection that the
UI consumes, and preserve `null` as a meaningful value.

#### Scenario: Column and projection
- **WHEN** events are written and read back
- **THEN** the turn key round-trips unchanged, including `null`
- **AND** the column is listed explicitly in every projection, never selected with a wildcard

#### Scenario: Slim projection
- **WHEN** the slim event tier is returned
- **THEN** it includes the turn key
- **AND** it still excludes all body columns

### Requirement: Reclassification migration

The schema bump accompanying event reclassification SHALL clear derived event data and
force a full rescan, because existing rows cannot be reclassified in place.

#### Scenario: Upgrade from the previous version
- **WHEN** a database created before this change starts with the new binary
- **THEN** the turn-key column is added, and events, event bodies, metrics, and scan state are cleared
- **AND** sessions, proxy requests, frida captures, and prompt context are preserved
- **AND** every session is marked as not having detail loaded

#### Scenario: Rescan reproduces the data
- **WHEN** the scan runs after the upgrade
- **THEN** every session whose source file is still present is repopulated
- **AND** the repopulated events carry the new classification and turn keys

#### Scenario: Repeated initialisation
- **WHEN** initialisation runs again against an already-migrated database
- **THEN** nothing is cleared a second time

#### Scenario: Migration fails
- **WHEN** the migration cannot complete
- **THEN** startup fails visibly with rebuild guidance
- **AND** the failure SHALL NOT be silently caught

#### Scenario: Preservation list is explicit
- **WHEN** the migration decides what to delete
- **THEN** it names the tables it clears
- **AND** it SHALL NOT be expressed as clearing everything except a named set, so that tables added later are preserved by default
