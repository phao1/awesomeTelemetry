## MODIFIED Requirements

### Requirement: REQ-006: raw retention off by default
Monitoring SHALL preserve original observed headers, URL, request/response bodies, prompts and tool data without redaction, as explicitly approved by the user. Original files SHALL be stored once with configurable quota; legacy redaction utilities SHALL NOT run on the monitoring path. Lists remain metadata-only. CA private keys are not business payload.

#### Scenario: Original content is retained
- **WHEN** a synthetic request contains credentials, personal text, structured tool arguments and UTF-8 data
- **THEN** local detail/export retains the exact observed values without masking and body bytes match their digest

### Requirement: REQ-007: Performance constraint
Monitoring SHALL stream original files asynchronously with bounded pending bytes and no regex processing on forwarding callbacks. Exceeding quota or per-body limits SHALL stop collection explicitly while preserving prior evidence and request forwarding.

#### Scenario: Storage is full
- **WHEN** the configured original-file quota is exhausted
- **THEN** new body capture reports quota_exceeded, existing originals are retained, and no automatic eviction occurs
