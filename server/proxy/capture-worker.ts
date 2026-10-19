import { isMainThread, parentPort, threadId } from 'node:worker_threads';
import { StringDecoder } from 'node:string_decoder';
import type { CaptureJob, CaptureProjection } from './capture-processor.js';
import { parseProxyRequest } from './parser-router.js';
import { SseDecoder, type SseEvent } from './sse-accumulator.js';
import { extractNetworkIdentities } from './identity-extractor.js';
import { contentEncoding, decodeBodyBytes } from './body-decoder.js';
import type { CaptureProcessingResult } from '../../src/core/trace-types.js';
import { classifyContentTiming } from './network-timing.js';
import { readWsArchive, wsTranscript } from './websocket-archive.js';
import { codexIdentity, object } from '../codex/source.js';
import { createIdentityCollector } from '../../src/adapters/native-identities.js';

export async function projectCapture(input: CaptureJob): Promise<CaptureProjection> {
  if (input.evidenceFormat === 'websocket_archive_v1') {
    const collector = createIdentityCollector();
    try {
      const archive = readWsArchive(input.requestBytes ?? new Uint8Array(), input.requestTruncated ?? input.previewTruncated);
      for (const frame of archive.records) {
        if (frame.kind !== 'message' || frame.binary) continue;
        const request = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame.payload)) as unknown);
        if (request?.type !== 'response.create') continue;
        const identity = codexIdentity(input.requestHeaders, request);
        if (identity.conflict) { collector.omit('native_session_conflict'); continue; }
        if (identity.sessionId === null) continue;
        const client = object(request.client_metadata);
        const root = 'awsp1.request[' + frame.sequence + '].client_metadata';
        const direct = client?.session_id === identity.sessionId ? '.session_id' : client?.thread_id === identity.sessionId ? '.thread_id' : null;
        let path = direct === null ? null : root + direct;
        if (path === null && typeof client?.['x-codex-turn-metadata'] === 'string') {
          const metadata = object(JSON.parse(client['x-codex-turn-metadata']) as unknown);
          const field = metadata?.session_id === identity.sessionId ? 'session_id' : metadata?.thread_id === identity.sessionId ? 'thread_id' : null;
          if (field !== null) path = root + '.x-codex-turn-metadata.' + field;
        }
        if (path === null) {
          const header = Object.entries(input.requestHeaders).find(([name]) => name.toLowerCase() === 'x-codex-turn-metadata')?.[1];
          const metadata = typeof header === 'string' ? object(JSON.parse(header) as unknown) : null;
          const field = metadata?.session_id === identity.sessionId ? 'session_id' : metadata?.thread_id === identity.sessionId ? 'thread_id' : null;
          if (field !== null) path = 'request.headers.x-codex-turn-metadata.' + field;
        }
        if (path !== null) collector.add('agent:codex', 'session', identity.sessionId, path);
      }
      if (archive.limited || input.requestTruncated || input.previewTruncated) collector.omit('source_preview_truncated');
    } catch { collector.omit('request_identity_unparsed'); }
    let reason: string | null = null;
    const transcript = (bytes: Uint8Array | undefined, direction: 'request' | 'response', partial: boolean) => {
      try { return wsTranscript(bytes ?? new Uint8Array(), direction, partial); }
      catch { reason = 'WS_ARCHIVE_INVALID'; return { text: null, truncated: true }; }
    };
    const request = transcript(input.requestBytes, 'request', input.requestTruncated ?? input.previewTruncated);
    const response = transcript(input.responseBytes, 'response', input.responseTruncated ?? input.previewTruncated);
    const truncated = request.truncated || response.truncated;
    return { parsed: { parserRoute: 'websocket_connection', requestFormat: 'unknown', model: null, systemPrompt: null, systemPromptLen: 0, inputTokens: null, outputTokens: null },
      identities: collector.finish(), processing: { version: 1, status: reason !== null ? 'decode_error' : truncated ? 'preview_truncated' : 'ok', error: reason ?? (truncated ? 'SOURCE_PREVIEW_TRUNCATED' : null) },
      workerThreadId: threadId, previews: { request: request.text, response: response.text, requestTruncated: request.truncated, responseTruncated: response.truncated } };
  }
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
  const timing = input.timing === undefined ? undefined : classifyContentTiming({ timing: input.timing,
    bytes: input.responseBytes ?? Buffer.from(input.responseBody ?? ''), timeline: input.responseTimeline,
    format: parsed.requestFormat ?? 'unknown', streaming: input.isStreaming,
    responseComplete: (input.responseTruncated ?? input.previewTruncated) !== true, encoding: responseEncoding });
  return { parsed, identities, processing, workerThreadId: threadId,
    ...(timing === undefined ? {} : { timing }),
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
