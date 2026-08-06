## ADDED Requirements

### Requirement: Provider-native session aggregation

Every scanner SHALL materialize one stored session per provider-native conversation boundary. Events belonging to the same native conversation SHALL be aggregated into that session, and events belonging to different native conversations MUST NOT be stored in the same session even when they share one source file or the same title.

For a source that contains multiple native conversations, stable keys SHALL be derived from the provider, source path, and native session identifier. Sources whose format guarantees one conversation per file SHALL retain their existing file-derived stable keys.

#### Scenario: Multiple conversations in one database

- **WHEN** one provider database contains N native session identifiers
- **THEN** the session list contains N independently addressable session cards
- **AND** each card contains only events associated with its native session identifier

#### Scenario: Duplicate titles remain separate

- **WHEN** two native sessions have the same displayed title but different native session identifiers
- **THEN** the system stores and displays two cards with different stable keys

#### Scenario: Existing one-file providers remain compatible

- **WHEN** a JSONL provider stores one native conversation per source file
- **THEN** the scanner continues to produce one card for that file using its existing stable key

### Requirement: Encrypted-source placeholder replacement

When a source cannot expose native session identifiers without decryption, the startup index phase MAY create one pending file-level placeholder without decrypting. After a successful background decrypt, the system SHALL replace that placeholder with the complete set of native session cards from the source and SHALL notify realtime consumers of both added and removed keys.

On later startups, an already materialized native-session set SHALL NOT be shadowed by recreating the file-level placeholder. A full authoritative source scan SHALL remove stale scan-generated sessions that no longer exist in that source.

#### Scenario: First successful decrypt expands placeholder

- **WHEN** a pending encrypted-source placeholder is followed by a successful decrypt containing N native sessions
- **THEN** the placeholder is removed and N native-session cards are stored
- **AND** no file-level aggregate card remains

#### Scenario: Restart preserves expanded cards

- **WHEN** the application restarts after native sessions were previously materialized and the encrypted source fingerprint is unchanged
- **THEN** the existing native-session cards remain visible
- **AND** no pending file-level placeholder is added

#### Scenario: Deleted native session is reconciled

- **WHEN** an authoritative source scan no longer contains a previously stored native session
- **THEN** that scan-generated session and its dependent detail data are removed

