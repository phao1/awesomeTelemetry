## ADDED Requirements

### Requirement: Session Prompt Context viewer

The session detail toolbar SHALL expose a Prompt Context action when a session is selected. Activating it SHALL open an accessible modal and lazily request that session's Prompt Context.

The modal SHALL identify database-derived content as “dynamic context only”, explain that the complete static System Prompt was not captured, and show overview metrics, model configuration, analysis findings, and ordered reminder sections. Duplicate sections SHALL be visibly marked and link their duplicate relationship by label.

#### Scenario: Captured Trae context

- **WHEN** the user opens Prompt Context for a Trae session with stored context
- **THEN** the modal displays provenance/completeness before any context body
- **AND** model configuration and reminder sections are readable without leaving the session

#### Scenario: Complete prompt unavailable

- **WHEN** the response has `completeness = 'dynamic_only'` and `fullSystemPrompt = null`
- **THEN** the UI explicitly states that the complete System Prompt is unavailable
- **AND** it does not label any reminder section as the complete System Prompt

### Requirement: Prompt Context viewer states

The Prompt Context modal SHALL implement loading, success, empty, and error states. Errors SHALL display localized copy and a retry action; catches MUST NOT be silent.

#### Scenario: Session without captured context

- **WHEN** the Prompt Context endpoint returns `PROMPT_CONTEXT_NOT_FOUND`
- **THEN** the modal displays an explanatory empty state
- **AND** offers a rescan-oriented hint instead of a blank body

#### Scenario: Request failure

- **WHEN** the Prompt Context request fails
- **THEN** the modal displays the error code/message and a retry action

