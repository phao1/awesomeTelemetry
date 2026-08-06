## ADDED Requirements

### Requirement: Decrypted Trae session partitioning

After decrypting a Trae database, the scanner SHALL use `chat_session.session_id` as the native conversation identity and SHALL produce one session card per `chat_session` row. Each card SHALL use that row's title and timestamps and SHALL contain only turns whose resolved session identity matches that `session_id`.

When a Trae history row references a `chat_message.message_id` instead of a session identifier, the scanner SHALL resolve it through `chat_message.session_id` before grouping. Session metadata and fallback message content SHALL be loaded in bulk and MUST NOT execute a prepared query once per session or event.

#### Scenario: Four visible Trae conversations

- **WHEN** the decrypted Trae database contains four native sessions updated in the selected time range
- **THEN** the UI receives four Trae session rows and displays four cards
- **AND** opening any card shows only that session's turns

#### Scenario: Message identifiers are resolved before grouping

- **WHEN** Trae history rows store message identifiers in their session reference column
- **THEN** each row is assigned to the session referenced by the matching `chat_message` row
- **AND** no row is attached to another Trae conversation

#### Scenario: Empty native conversation

- **WHEN** a `chat_session` row exists without history events
- **THEN** the system still materializes a zero-event session using the native title and timestamps

