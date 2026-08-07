## ADDED Requirements

### Requirement: Capture-group persistence and migration
Storage SHALL add nullable `capture_group_id` evidence and non-null `request_format` classification to proxy requests through a non-destructive schema migration. Existing proxy rows SHALL remain readable with null capture-group identity and `unknown` request format, and rollback to an older binary SHALL leave existing session/event data unaffected.

#### Scenario: Existing database upgrade
- **WHEN** a database created before this change starts with the new binary
- **THEN** the capture-group and request-format columns plus required indexes are added idempotently
- **AND** all existing proxy rows remain present with null capture-group identity and `unknown` request format

#### Scenario: Migration fails
- **WHEN** schema migration cannot complete
- **THEN** startup fails visibly with a rebuild instruction
- **AND** the error SHALL NOT be silently caught

### Requirement: Capture-group list metadata
Proxy list queries SHALL return `captureGroupId` and `requestFormat` metadata while continuing to exclude request/response bodies, raw bodies, system prompt body, and request headers.

#### Scenario: Proxy list after new capture
- **WHEN** `/api/proxy/requests` returns a newly captured row
- **THEN** the item includes its capture-group identifier and request format
- **AND** no excluded body or header field is present

#### Scenario: Historical proxy row
- **WHEN** `/api/proxy/requests` returns a row created before migration
- **THEN** `captureGroupId` is null
- **AND** `requestFormat` is `unknown`
- **AND** list serialization does not fail

### Requirement: Indexed predecessor lookup
Storage SHALL support nearest-earlier predecessor lookup by `(parsed_session_id, request_format, id)` and `(capture_group_id, request_format, model, id)` without `SELECT *`, an in-loop prepare, `ORDER BY LENGTH`, or a temporary B-tree sort.

#### Scenario: Exact-session predecessor query plan
- **WHEN** the exact-session predecessor query is inspected with `EXPLAIN QUERY PLAN`
- **THEN** it uses the composite parsed-session/id index
- **AND** the plan does not contain `USE TEMP B-TREE`

#### Scenario: Capture-group predecessor query plan
- **WHEN** the capture-group predecessor query is inspected with `EXPLAIN QUERY PLAN`
- **THEN** it uses the composite capture-group/id index
- **AND** the plan does not contain `USE TEMP B-TREE`

### Requirement: Two-row body access boundary
One context-diff request SHALL read only the target row and one selected base row, listing required columns explicitly. It SHALL NOT scan or deserialize every request in a capture group or parsed session.

#### Scenario: Capture group contains many requests
- **WHEN** a capture group contains 10,000 rows and the target has an eligible predecessor
- **THEN** storage returns only the target and nearest eligible base rows
- **AND** no body from unrelated rows is loaded
