// contracts/database.md §5.2 列常量，逐字采用。禁止 SELECT *。

export const SESSION_LIST_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at',
  'status', 'cwd', 'event_count', 'message_count', 'token_total', 'cost_usd',
  'data_source', 'source_path', 'detail_loaded',
  "CASE WHEN system_prompt IS NOT NULL AND system_prompt != '' THEN 1 ELSE 0 END AS has_system_prompt",
].join(', ');

export const EVENT_SLIM_COLS = [
  'session_id', 'id', 'sequence', 'kind', 'phase', 'title', 'started_at',
  'duration_ms', 'status', 'actor', 'tool', 'tokens_json', 'error', 'model',
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
  'cost_source', 'duration_source',
].join(', ');

export const PROXY_LIST_COLS = [
  'id', 'request_id', 'method', 'url', 'hostname', 'response_status',
  'content_type', 'is_streaming', 'started_at', 'completed_at', 'duration_ms',
  'capture_method', 'ttnet_encrypted', 'model', 'input_tokens', 'output_tokens',
  'parsed_session_id', 'parser_route', 'capture_group_id', 'request_format',
  'CASE WHEN system_prompt_len > 0 THEN 1 ELSE 0 END AS has_system_prompt',
].join(', ');
