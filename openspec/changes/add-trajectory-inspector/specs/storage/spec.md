## ADDED Requirements

### Requirement: Session annotation persistence and migration

Storage SHALL persist per-session tags and a free-text note in a dedicated table added
through an additive migration. No existing table, column, index, or projection SHALL be
modified.

#### Scenario: Fresh database
- **WHEN** a database is created by the new binary
- **THEN** the annotations table and its index exist and the recorded schema version is the new one

#### Scenario: Existing database upgrade
- **WHEN** a database created before this change starts with the new binary
- **THEN** the table and index are created idempotently and every existing row is preserved

#### Scenario: Repeated initialisation
- **WHEN** initialisation runs twice
- **THEN** the second run changes nothing and does not fail

#### Scenario: Newer schema version
- **WHEN** a database recorded at a higher version is opened
- **THEN** startup refuses visibly and does not downgrade the data

#### Scenario: Migration fails
- **WHEN** the migration cannot complete
- **THEN** startup fails visibly with rebuild guidance and the failure SHALL NOT be silently caught

#### Scenario: Annotations survive the reclassification migration
- **GIVEN** a database holding session annotations
- **WHEN** the event-reclassification migration from the preceding change runs against it
- **THEN** the annotation rows are still present afterwards

### Requirement: Annotation read and write

Storage SHALL expose a reader, a writer, and a tag-vocabulary query, all using cached
prepared statements and explicit column lists.

#### Scenario: Reading an unannotated session
- **WHEN** annotations are read for a session with no row
- **THEN** the result is an empty tag list, a null note, and a null timestamp
- **AND** no row is created as a side effect

#### Scenario: Round trip
- **WHEN** tags and a note are written and read back
- **THEN** the tags return trimmed, lowercased, de-duplicated, and sorted ascending
- **AND** the timestamp is an ISO 8601 UTC string

#### Scenario: Partial update
- **GIVEN** a session with both fields stored
- **WHEN** an update supplies only one field
- **THEN** the other is unchanged

#### Scenario: Clearing
- **WHEN** an update supplies an empty tag list
- **THEN** the stored tags become empty
- **AND** a null note clears the stored note

#### Scenario: Bounds
- **WHEN** a value exceeds a defined bound
- **THEN** a typed error is raised and nothing is persisted
- **AND** the value SHALL NOT be silently truncated

#### Scenario: Cascade delete
- **WHEN** a session is deleted
- **THEN** its annotation row is removed by the foreign key cascade

#### Scenario: Tag vocabulary
- **WHEN** the tag vocabulary is queried
- **THEN** it returns each distinct tag with the number of sessions carrying it
- **AND** it runs as one query, never one per session

#### Scenario: Query discipline
- **WHEN** annotation statements execute
- **THEN** they name their columns, never `SELECT *`
- **AND** the read plan is a primary-key lookup with no temporary B-tree
- **AND** no statement is prepared inside a loop

### Requirement: Session list tag projection and filtering

The session list SHALL return each session's tags and SHALL support an OR tag filter,
without adding a per-row query and without relaxing any existing list exclusion.

#### Scenario: Tags on list rows
- **WHEN** the session list is queried
- **THEN** each row carries its tag array, empty when unannotated
- **AND** the list still excludes every body column it excluded before

#### Scenario: OR semantics
- **WHEN** the list is filtered by two tags
- **THEN** sessions carrying either tag are returned, matching the existing multi-select filters

#### Scenario: Filter bounds
- **WHEN** more tags than the cap are supplied
- **THEN** the request is rejected rather than truncated

#### Scenario: No per-row query
- **WHEN** the list returns many rows
- **THEN** the tag data comes from a join evaluated once
- **AND** the number of statements executed does not grow with the row count

#### Scenario: Plan and cost
- **WHEN** the list query plan is inspected with the join active
- **THEN** it contains no temporary B-tree
- **AND** the measured list cost against the recorded baseline is captured, and a material degradation is reported rather than shipped
