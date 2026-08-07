## ADDED Requirements

### Requirement: Proxy capture-group identity
Each successful proxy start SHALL create one opaque capture-group identifier. Every request recorded by that running proxy instance SHALL persist the same identifier; a later proxy start SHALL use a different identifier. Capture-group identity is correlation evidence only and SHALL NOT be presented as an agent session identifier.

#### Scenario: Requests from one proxy run
- **WHEN** three requests are recorded between one successful proxy start and stop
- **THEN** all three rows contain the same non-empty capture-group identifier

#### Scenario: Proxy restarts
- **WHEN** the proxy is stopped and started again
- **THEN** newly recorded requests use a capture-group identifier different from the previous run

#### Scenario: Startup fails
- **WHEN** proxy startup fails before entering the running state
- **THEN** no capture group is exposed as active
- **AND** no request is written with the failed startup's identifier

### Requirement: Diff-normalizable parser evidence
For supported Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses requests, capture SHALL retain the desensitized request body, parser route, and explicit request-format classification needed by request-context normalization. Unknown or malformed bodies SHALL use request format `unknown`; capture SHALL continue forwarding and recording them.

#### Scenario: Supported request captured
- **WHEN** a supported model request passes through the proxy
- **THEN** the stored desensitized body, parser route, and request format are sufficient to normalize it deterministically

#### Scenario: Unsupported request captured
- **WHEN** a request does not match a supported context format
- **THEN** ordinary proxy capture still succeeds
- **AND** its request format is `unknown`
- **AND** only the later context-diff action reports unsupported input

### Requirement: No forwarding-path diff work
Proxy capture SHALL NOT normalize a complete context snapshot, align messages, or calculate semantic differences on the request-forwarding path.

#### Scenario: Streaming response under load
- **WHEN** the proxy is forwarding an SSE or WebSocket response while requests are being stored
- **THEN** no request-context diff computation executes
- **AND** stream forwarding and existing 100 ms SSE coalescing behavior are unchanged
