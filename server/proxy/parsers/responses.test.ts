import { describe, expect, it } from 'vitest';
import { parseResponsesRequest } from './responses.js';

describe('Responses context and JSON usage', () => {
  it('retains instructions and nested response usage without rewriting the request', () => {
    const requestBody = JSON.stringify({ model: 'response-model', instructions: 'original synthetic Bearer value', input: 'hello' });
    expect(parseResponsesRequest({ requestBody, responseBody: '{"response":{"usage":{"input_tokens":12,"output_tokens":7}}}' })).toEqual({
      model: 'response-model', systemPrompt: 'original synthetic Bearer value', systemPromptLen: 31, inputTokens: 12, outputTokens: 7,
    });
  });

  it('missing instructions and usage are unknown rather than empty or zero', () => {
    expect(parseResponsesRequest({ requestBody: '{"model":"x","input":[]}' })).toMatchObject({ systemPrompt: null, inputTokens: null, outputTokens: null });
  });
});
