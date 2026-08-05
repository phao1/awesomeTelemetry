# Spec: Realtime

> Real-time event bus + SSE broadcast + event coalescing. Source files:
> `server/realtime/`

## Purpose

Push backend events to the frontend in real time, driving the live indicator
and incremental list refresh.
**Core constraint: events are signals for the frontend to do local patches,
not triggers for the frontend to refetch everything.**

## Requirements

### REQ-001: TypedEventBus
The system SHALL provide a `TypedEventBus` whose events and payloads map
exactly to `BusEvents` in `contracts/data-model.md` §10. MUST NOT define events
outside that contract.

### REQ-002: Singleton bus
`eventBus` SHALL be a module-level singleton shared by the whole app.

### REQ-003: Session-change coalescing (v5 core)
`queueSessionChange(key)` SHALL accumulate keys into a pending set and emit one
`sessions_changed { keys, count }` after a **200ms window**.

Per-session `session_updated` emission MUST NOT exist.

#### Scenario: one full scan round
- **GIVEN** 524 sessions updated in one scan round
- **WHEN** event coalescing applies
- **THEN** the number of emitted `sessions_changed` events <= 10
- **AND** v4's per-event emission caused 508 requests / 151.2MB in a 30s
  browser window

#### Scenario: timer must not prevent process exit
- **GIVEN** a coalescing-window timer is scheduled
- **THEN** MUST call `timer.unref()`, otherwise the CLI cannot exit normally

### REQ-004: Server-side throttling of streaming chunks
When MITM captures SSE streams, chunks of the same `requestId` MUST be
concatenated server-side on a **100ms window** before emitting
`proxy_stream_chunk`. The frontend MUST NOT throttle again.

> v4's spec only said "high frequency, frontend should throttle" without
> defining the mechanism — a spec flaw that pushes responsibility downstream.

### REQ-005: SSE broadcaster
`addSseClient(res)` SHALL:
- write 200 + `text/event-stream` + `cache-control: no-cache` +
  `connection: keep-alive`
- send an initial `connected` event whose payload contains `serverTime` and
  `schemaVersion`
- send a comment-line heartbeat every 30s (`: ping\n\n`) to prevent
  proxy-layer timeouts
- return a cleanup function

### REQ-006: Event forwarding
The SSE broadcaster SHALL subscribe to all `BusEvents` and forward them to all
clients. On client disconnect, MUST run cleanup to unsubscribe everything.

### REQ-007: Foreground request marking
Every `/api/*` request MUST call `markForegroundRequest()` on entry.
`isForegroundBusy()` returns true when a request was seen within 750ms, so
background prewarm yields.

### REQ-008: Cleanup
`closeSseBroadcaster()` SHALL cancel all subscriptions, clear the coalescer's
pending set, and close all client connections.

## Gotchas
- SSE connections must handle client disconnect
- G11.7 (new): the correct mental model for SSE events is "which keys
  changed", not "something changed, go refetch". The former is O(changes), the
  latter O(total × changes)
- G11.8 (new): the coalescing-window timer must `unref()`, otherwise the CLI
  hangs and won't exit
