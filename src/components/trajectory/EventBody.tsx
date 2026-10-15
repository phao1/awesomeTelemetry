import { Fragment, type ReactNode } from 'react';
import { RENDER_MAX_CHARS } from './renderers/index.js';

/** Decode persisted content blocks for reading; Source/Raw retain the original. */
export function readableContent(text: string, depth = 0): string {
  if (depth > 4 || text.length > RENDER_MAX_CHARS) return text;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return text; }
  if (Array.isArray(value) && value.every((part) => part !== null && typeof part === 'object' && 'type' in part)) {
    return value.map((part: { type: string; text?: unknown }) => typeof part.text === 'string'
      ? readableContent(part.text, depth + 1) : `[${part.type}]`).join('\n\n');
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.output === 'string' && ('exit_code' in obj || 'wall_time_seconds' in obj || 'session_id' in obj)) {
      const meta = ['exit_code', 'wall_time_seconds', 'session_id'].filter((key) => obj[key] !== undefined)
        .map((key) => `${key}: ${String(obj[key])}`).join(' · ');
      return `${meta}\n${readableContent(obj.output, depth + 1)}`;
    }
    return JSON.stringify(value, null, 2);
  }
  return text;
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code>
      : part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}

/** Small safe Markdown reader: React text only, never injected HTML. */
export function EventBody({ text, prose = false }: { text: string; prose?: boolean }): React.JSX.Element {
  const readable = readableContent(text);
  if (!prose || readable.length > RENDER_MAX_CHARS) return <pre className="mono event-body-code">{readable}</pre>;
  return <div className="event-body-prose">{readable.split(/(```[\s\S]*?```)/g).map((part, i) => {
    if (part.startsWith('```')) return <pre key={i} className="mono event-body-code">{part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</pre>;
    return <Fragment key={i}>{part.split('\n').map((line, j) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) return <h4 key={j}>{inline(heading[2]!)}</h4>;
      if (/^\s*[-*]\s+/.test(line)) return <div key={j} className="event-body-bullet">• {inline(line.replace(/^\s*[-*]\s+/, ''))}</div>;
      return line.trim() ? <p key={j}>{inline(line)}</p> : null;
    })}</Fragment>;
  })}</div>;
}
