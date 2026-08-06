## ADDED Requirements

### Requirement: Prompt Context persistence

Storage SHALL maintain at most one Prompt Context row per stored session. Writes SHALL use an idempotent upsert and SHALL replace the previous row only after a successful Trae source parse. Reads SHALL select columns explicitly through a reused prepared statement.

Deleting a session SHALL also delete its Prompt Context row. Existing databases SHALL receive the table through a non-destructive schema migration.

#### Scenario: Updated Trae turn

- **WHEN** a later Trae scan finds a newer prompt envelope for the same session
- **THEN** the Prompt Context row is updated in place
- **AND** no duplicate row is created

#### Scenario: Session deletion

- **WHEN** a session with Prompt Context is deleted
- **THEN** its Prompt Context row is absent after the delete transaction

