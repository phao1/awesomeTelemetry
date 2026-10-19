// contracts/database.md §5.2 列常量，逐字采用。禁止 SELECT *。
export const TRACE_LOG_IMPORT_COLS = 'id, imported_at, metadata_json, session_offset, session_length, session_sha256';
export const TRACE_LOG_TURN_COLS = 'import_id, sequence, metadata_json, byte_offset, byte_length, body_sha256';

export const SESSION_LIST_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at',
  'status', 'cwd', 'event_count', 'message_count', 'token_total', 'cost_usd',
  'data_source', 'source_path', 'detail_loaded',
  "CASE WHEN system_prompt IS NOT NULL AND system_prompt != '' THEN 1 ELSE 0 END AS has_system_prompt",
].join(', ');

export const EVENT_SLIM_COLS = [
  'session_id', 'id', 'sequence', 'kind', 'phase', 'title', 'started_at',
  'duration_ms', 'status', 'actor', 'tool', 'tokens_json', 'error', 'model',
  'turn_key',
  "CASE WHEN input_summary  IS NOT NULL AND input_summary  != '' THEN 1 ELSE 0 END AS has_input",
  "CASE WHEN output_summary IS NOT NULL AND output_summary != '' THEN 1 ELSE 0 END AS has_output",
].join(', ');

export const EVENT_FULL_COLS = `${EVENT_SLIM_COLS}, input_summary, output_summary`;

/** 会话详情读取列（contracts/database.md §5.2）。 */
export const SESSION_DETAIL_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at',
  'status', 'cwd', 'message_count', 'event_count', 'token_input',
  'token_output', 'token_reasoning', 'token_cache_read', 'token_cache_write',
  'token_total', 'cost_usd', 'system_prompt', 'source_path', 'data_source',
  'total_duration_ms', 'is_subagent', 'detail_loaded', 'primary_model',
  'cost_source', 'duration_source', 'cost_currency',
].join(', ');

export const PROXY_LIST_COLS = [
  'id', 'request_id', 'method', 'url', 'hostname', 'response_status',
  'content_type', 'is_streaming', 'started_at', 'completed_at', 'duration_ms',
  'capture_method', 'ttnet_encrypted', 'model', 'input_tokens', 'output_tokens',
  'parsed_session_id', 'parser_route', 'capture_group_id', 'request_format',
  'CASE WHEN system_prompt_len > 0 THEN 1 ELSE 0 END AS has_system_prompt',
].join(', ');

export const PROXY_CAPTURE_BODY_COLS = 'proxy_id, request_ref, response_ref, request_preview_truncated, response_preview_truncated, response_headers';
export const PROXY_CAPTURE_PROCESSING_COLS = 'proxy_id, result_json';
export const PROXY_CAPTURE_TRANSPORT_COLS = 'proxy_id, result_json';
export const PROXY_CAPTURE_ANALYSIS_COLS = 'proxy_id, parser_version, metric_version, source_fingerprint, parsed_at, request_format, state, usage_json, completeness_json';
export const PROXY_CAPTURE_TOMBSTONE_COLS = 'request_id, request_body_id, response_body_id, deleted_at';

/** session_annotations 读取列（contracts/database.md §3.10）。显式列，禁止 SELECT *。 */
export const SESSION_ANNOTATION_COLS = [
  'session_id', 'tags_json', 'note', 'updated_at',
].join(', ');

// ── v10（add-agent-team-observability）team 列常量，禁止 SELECT * ──────────
// contracts/database.md §5.2 逐字采用。slim 表绝不含 body 列（body 只在
// team_activity_bodies）。

export const TEAM_RUN_LIST_COLS = [
  'id', 'provider', 'native_run_id', 'run_identity_confidence', 'title',
  'goal_fingerprint', 'status', 'started_at', 'ended_at', 'topology_kind',
  'agent_count', 'task_count', 'communication_count', 'activity_count',
  'round_count', 'artifact_count', 'token_available', 'cost_available',
  'cost_currency', 'completeness_json', 'updated_at', 'stamp',
].join(', ');

export const TEAM_AGENT_COLS = [
  'id', 'run_id', 'native_id', 'display_name', 'role', 'role_class', 'model',
  'state', 'created_at', 'ended_at', 'session_keys_json', 'evidence_ids_json',
].join(', ');

export const TEAM_EDGE_COLS = [
  'id', 'run_id', 'from_agent_id', 'to_agent_id', 'kind', 'valid_from',
  'valid_to', 'confidence', 'evidence_ids_json',
].join(', ');

export const TEAM_TASK_COLS = [
  'id', 'run_id', 'native_id', 'title', 'description_available', 'priority',
  'status', 'created_at', 'started_at', 'completed_at', 'cancelled_at',
  'failed_at', 'result_available', 'evidence_ids_json',
].join(', ');

export const TEAM_DEP_COLS = [
  'id', 'run_id', 'upstream_task_id', 'downstream_task_id', 'valid_from',
  'valid_to', 'confidence', 'evidence_ids_json',
].join(', ');

export const TEAM_ASSIGNMENT_COLS = [
  'id', 'run_id', 'task_id', 'agent_id', 'assigned_at', 'unassigned_at',
  'assignment_kind', 'evidence_ids_json',
].join(', ');

export const TEAM_MESSAGE_COLS = [
  'id', 'run_id', 'sender_agent_id', 'recipient_ids_json', 'mode', 'category',
  'task_id', 'correlation_id', 'reply_to_id', 'sent_at', 'received_at',
  'body_available', 'body_chars', 'body_bytes', 'content_hash',
  'evidence_ids_json',
].join(', ');

export const TEAM_ACTIVITY_SLIM_COLS = [
  'id', 'run_id', 'agent_id', 'task_id', 'round_id', 'kind', 'status',
  'started_at', 'ended_at', 'native_sequence', 'session_key', 'event_id',
  'turn_key', 'message_id', 'artifact_id', 'tokens_json', 'cost_usd',
  'cost_source', 'cost_currency', 'has_input', 'has_output', 'has_raw',
  'evidence_ids_json', 'order_confidence',
].join(', ');

export const TEAM_ROUND_COLS = [
  'id', 'run_id', 'agent_id', 'native_id', 'idx', 'segmentation_source',
  'started_at', 'ended_at', 'status', 'task_ids_json',
  'output_artifact_ids_json', 'wall_clock_ms', 'active_ms', 'tokens_json',
  'cost_usd', 'tool_call_count', 'message_count', 'completeness',
].join(', ');

export const TEAM_ARTIFACT_COLS = [
  'id', 'run_id', 'native_id', 'name', 'kind', 'path_redacted', 'content_hash',
  'producer_agent_ids_json', 'task_ids_json', 'created_at', 'accepted_at',
  'has_content', 'evidence_ids_json',
].join(', ');

export const TEAM_EVIDENCE_COLS = [
  'id', 'run_id', 'source_kind', 'source_locator', 'native_id',
  'native_sequence', 'captured_at', 'confidence', 'parser_version',
].join(', ');

export const TEAM_METRICS_COLS = [
  'run_id', 'calc_version', 'generated_at', 'metrics_json',
].join(', ');

export const TEAM_RUN_SESSION_COLS = ['run_id', 'session_id'].join(', ');
export const TRACE_IDENTITY_SOURCE_COLS = 'id, session_key, proxy_id, parser_version, complete, omitted_count, reasons_json, content_sha256, updated_at';
export const TRACE_IDENTITY_COLS = 'id, source_id, namespace, kind, value, scope, event_id, source_path';
export const TRACE_ASSOCIATION_COLS = 'id, session_key, proxy_id, state, reason, created_at, updated_at';
export const TRACE_ASSOCIATION_DECISION_COLS = 'sequence, association_id, state, note, decided_at';
export const PROXY_ORIGINAL_DELETION_COLS = 'id, proxy_id, request_id, request_ref, response_ref, store_directory, state, error, created_at, updated_at, completed_at';
export const PROXY_ORIGINAL_REF_COLS = 'request_ref, response_ref';
export const ORIGINAL_DELETION_STATUS_COLS = 'id, proxy_id, request_id, state, error, created_at, updated_at, completed_at';
