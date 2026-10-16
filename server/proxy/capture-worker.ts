import { isMainThread, parentPort, threadId } from 'node:worker_threads';
import { StringDecoder } from 'node:string_decoder';
import type { CaptureJob, CaptureProjection } from './capture-processor.js';
import { parseProxyRequest } from './parser-router.js';
import { SseDecoder, type SseEvent } from './sse-accumulator.js';
import { extractNetworkIdentities } from './identity-extractor.js';
import { contentEncoding, decodeBodyBytes } from './body-decoder.js';
import type { CaptureProcessingResult } from '../../src/core/trace-types.js';

export async function projectCapture(input: CaptureJob): Promise<CaptureProjection> {
  const header = (values: Record<string, string | string[]>): string | undefined => {
    const value = Object.entries(values).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1];
    return Array.isArray(value) ? value.join(',') : value;
  };
  const requestEncoding = header(input.requestHeaders), responseEncoding = header(input.responseHeaders);
  const contentDecoding = { request: contentEncoding(requestEncoding), response: contentEncoding(responseEncoding) };
  const events: SseEvent[] | undefined = input.isStreaming ? [] : undefined;
  const sse = input.isStreaming ? new SseDecoder() : null;
  let eventLimit = false;
  const request = await decodeBodyBytes(input.requestBytes ?? Buffer.from(input.requestBody), { contentEncoding: requestEncoding, allowTruncatedUtf8: input.requestTruncated ?? input.previewTruncated });
  const response = await decodeBodyBytes(input.responseBytes ?? Buffer.from(input.responseBody ?? ''), { contentEncoding: responseEncoding, allowTruncatedUtf8: input.responseTruncated ?? input.previewTruncated, onText: text => {
    if (sse === null) return;
    const batch = sse.push(text); const remaining = Math.max(0, 8192 - events!.length);
    if (batch.length > remaining) eventLimit = true;
    events!.push(...batch.slice(0, remaining));
  } });
  if (sse !== null) events!.push(...sse.finish());
  const requestBody = request.ok ? request.body : '', responseBody = response.ok ? response.body : null;
  const parsed = parseProxyRequest({ ...input, requestBody, responseBody: input.isStreaming ? null : responseBody, sseEvents: response.ok ? events : undefined });
  if (parsed.systemPrompt !== null) {
    parsed.systemPrompt = new StringDecoder('utf8').write(Buffer.from(parsed.systemPrompt).subarray(0, 64 * 1024));
    parsed.systemPromptLen = parsed.systemPrompt.length;
  }
  const identities = extractNetworkIdentities({ ...input, requestBody, responseBody, format: parsed.requestFormat ?? 'unknown', sseEvents: response.ok ? events : undefined });
  const reason = !request.ok ? request.reason.toUpperCase() : !response.ok ? response.reason.toUpperCase()
    : eventLimit || (sse?.droppedEvents ?? 0) > 0 ? 'SSE_EVENT_LIMIT' : (sse?.incompleteEvents ?? 0) > 0 ? 'SSE_INCOMPLETE_FRAME' : null;
  if (reason !== null) { identities.completeness.complete = false; identities.completeness.omittedCount += 1; identities.completeness.reasons.push(reason); }
  const processing: CaptureProcessingResult = { version: 1, status: reason !== null ? 'decode_error' : input.previewTruncated ? 'preview_truncated' : 'ok', error: reason ?? (input.previewTruncated ? 'SOURCE_PREVIEW_TRUNCATED' : null), contentDecoding };
  const clip = (text: string): string => new StringDecoder('utf8').write(Buffer.from(text).subarray(0, 64 * 1024));
  return { parsed, identities, processing, workerThreadId: threadId,
    previews: { request: requestBody === '' ? null : clip(requestBody), response: !response.ok || responseBody === '' ? null : clip(responseBody!), requestTruncated: input.requestTruncated === true || Buffer.byteLength(requestBody) > 64 * 1024, responseTruncated: input.responseTruncated === true || Buffer.byteLength(responseBody ?? '') > 64 * 1024 } };
}

if (!isMainThread && parentPort !== null) {
  const port = parentPort;
  port.on('message', async (message: { id: number; input: CaptureJob }) => {
    try {
      const result = await projectCapture(message.input);
      if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) port.postMessage({ id: message.id, error: 'result_limit' });
      else port.postMessage({ id: message.id, result });
    } catch { port.postMessage({ id: message.id, error: 'worker_error' }); }
  });
}
