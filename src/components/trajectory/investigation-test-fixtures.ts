import type { TraceEvent, TurnMessage, TurnModel } from '../../core/trace-types.js';
import { makeSession } from '../compare-test-fixtures.js';

export function makeMessage(id = 'e1', sequence = 1, over: Partial<TurnMessage> = {}): TurnMessage {
  return { eventId: id, sequence, role: 'tool', kind: 'file_read', title: `Read synthetic ${id}`, tool: 'Read',
    startedAt: '2026-10-17T00:00:00.000Z', durationMs: 100, status: 'success', tokens: null,
    hasInput: true, hasOutput: true, hasRaw: true, error: null, ...over };
}
export function makeModel(messages: TurnMessage[], complete = true): TurnModel {
  return { turns: [{ index: 1, kind: 'cycle', startedAt: '2026-10-17T00:00:00.000Z', durationMs: 100,
    tokens: makeSession('s').tokenUsage, model: 'synthetic-model', messageCount: messages.length,
    toolCount: messages.filter(message => message.role === 'tool').length, status: 'success', badges: [], messages }],
    segmentationSource: 'sequence_fallback', complete, omittedEventCount: complete ? 0 : 7 };
}
export function makeEvent(message = makeMessage(), output = 'SYNTHETIC_READ_RESULT'): TraceEvent {
  const { eventId, role: _role, ...slim } = message;
  return { ...slim, id: eventId, sessionId: 's', turnKey: null, phase: 'implement', actor: 'assistant',
    inputSummary: '{"filePath":"/tmp/synthetic.txt"}', outputSummary: output };
}
