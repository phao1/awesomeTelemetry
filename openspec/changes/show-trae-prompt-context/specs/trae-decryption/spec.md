## ADDED Requirements

### Requirement: Database prompt context extraction

After decrypting a Trae database, the scanner SHALL retain the latest persisted user-message dynamic reminder envelope and the latest `chat_turn.context` metadata within each native `chat_session.session_id` boundary. It SHALL pair neither message bodies nor turn metadata across native sessions.

The scanner SHALL extract only a whitelisted model/runtime subset from `chat_turn.context`, including model name, configuration name, prompt limit, output limit, maximum turns, preset flag, locale, agent type/name, and enabled boolean feature flags.

#### Scenario: Latest prompt envelope per native session

- **WHEN** one native Trae session has multiple user turns with dynamic reminders
- **THEN** the stored Prompt Context uses the most recently persisted reminder envelope and turn metadata for that session
- **AND** its capture time corresponds to that envelope

#### Scenario: Missing prompt context fields

- **WHEN** a Trae schema lacks `chat_turn.context` or a user message has no `<system-reminder>` blocks
- **THEN** ordinary session and event extraction still succeeds
- **AND** no Prompt Context row is written for that session

