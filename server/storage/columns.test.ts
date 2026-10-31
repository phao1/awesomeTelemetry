import { describe, expect, it } from 'vitest';
import { PROXY_CAPTURE_ANALYSIS_COLS } from './columns.js';

describe('metadata-only capture reparse columns', () => {
  it('adopts the exact schema18 explicit column contract without source content', () => {
    expect(PROXY_CAPTURE_ANALYSIS_COLS).toBe('proxy_id, parser_version, metric_version, source_fingerprint, parsed_at, request_format, state, usage_json, completeness_json');
    expect(PROXY_CAPTURE_ANALYSIS_COLS).not.toMatch(/body|raw|summary|headers|system_prompt|snapshots|\*/);
  });
});
