import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RENDER_MAX_CHARS, RENDER_MAX_LINES, type ToolRenderResult } from './index.js';
import { bashRenderer, renderBashArguments, renderBashResult } from './bash.js';
import { editRenderer, renderEditArguments, renderEditResult } from './edit.js';
import { globRenderer, renderGlobArguments, renderGlobResult } from './glob.js';
import { grepRenderer, renderGrepArguments, renderGrepResult } from './grep.js';
import { readRenderer, renderReadArguments, renderReadResult } from './read.js';
import { todowriteRenderer, renderTodoWriteArguments, renderTodoWriteResult } from './todowrite.js';
import { writeRenderer, renderWriteArguments, renderWriteResult } from './write.js';

function markup(result: ToolRenderResult): string {
  if (result.kind === 'fallback') {
    return '';
  }
  return renderToStaticMarkup(result.node as React.ReactElement);
}

const oversizedValidJson = JSON.stringify({ file_path: 'x'.repeat(RENDER_MAX_CHARS) });

const allRenderers = [
  readRenderer,
  bashRenderer,
  todowriteRenderer,
  grepRenderer,
  globRenderer,
  editRenderer,
  writeRenderer,
] as const;

describe('read renderer (task 7.3)', () => {
  it('renders path with muted directory, emphasised basename, language and offset/limit', () => {
    const html = markup(renderReadArguments('{"file_path":"/src/core/a.ts","offset":12,"limit":60}'));
    expect(html).toContain('/src/core/');
    expect(html).toContain('a.ts');
    expect(html).toContain('typescript');
    expect(html).toContain('offset 12');
    expect(html).toContain('limit 60');
  });

  it('accepts a bare path string as arguments', () => {
    const html = markup(renderReadArguments('src/main.py'));
    expect(html).toContain('main.py');
  });

  it('returns fallback for a JSON object without a path', () => {
    expect(renderReadArguments('{"foo":1}')).toEqual({ kind: 'fallback' });
  });

  it('returns fallback for multiline non-JSON text', () => {
    expect(renderReadArguments('line one\nline two')).toEqual({ kind: 'fallback' });
  });

  it('renders result as a line-numbered fenced block keeping embedded numbers', () => {
    const html = markup(renderReadResult('12\tfunction x() {\n13\t  return 1;\n}'));
    expect(html).toContain('12\tfunction x() {');
    expect(html).toContain('13\t  return 1;');
    expect(html).toContain('<pre');
  });

  it('numbers result lines sequentially when the source carries no numbers', () => {
    const html = markup(renderReadResult('a\nb'));
    expect(html).toContain('1\ta');
    expect(html).toContain('2\tb');
  });

  it('truncates an oversized result before parsing', () => {
    expect(renderReadResult(oversizedValidJson)).toEqual({ kind: 'fallback' });
  });
});

describe('bash renderer (task 7.4)', () => {
  it('renders command on canvas-inset with the description as a leading comment', () => {
    const html = markup(renderBashArguments('{"command":"ls -la","description":"List files"}'));
    expect(html).toContain('ls -la');
    expect(html).toContain('# List files');
  });

  it('accepts a bare command string as arguments', () => {
    const html = markup(renderBashArguments('pwd'));
    expect(html).toContain('pwd');
  });

  it('returns fallback for a JSON object without a command', () => {
    expect(renderBashArguments('{"description":"no command"}')).toEqual({ kind: 'fallback' });
  });

  it('returns fallback for empty input', () => {
    expect(renderBashArguments('')).toEqual({ kind: 'fallback' });
  });

  it('marks error lines via the shared error classifier, never a second pattern list', () => {
    const html = markup(renderBashResult('total 0\nzsh: command not found: foo\ndone'));
    expect(html).toContain('tr-renderer-bash-error');
    expect(html).toContain('command not found');
    expect(html).toContain('total 0');
  });

  it('leaves ordinary lines unstyled', () => {
    const html = markup(renderBashResult('success line'));
    expect(html).not.toContain('tr-renderer-bash-error');
  });

  it('truncates an oversized result before parsing', () => {
    expect(renderBashResult(oversizedValidJson)).toEqual({ kind: 'fallback' });
  });
});

describe('todowrite renderer (task 7.5)', () => {
  it('renders each todo with an icon plus a label per status and a priority badge', () => {
    const html = markup(
      renderTodoWriteArguments(
        '{"todos":[{"content":"Fix bug","status":"in_progress"},{"content":"Ship it","status":"completed","priority":"high"},{"content":"Later","status":"pending"}]}',
      ),
    );
    expect(html).toContain('Fix bug');
    expect(html).toContain('<title>in_progress</title>');
    expect(html).toContain('<title>completed</title>');
    expect(html).toContain('<title>pending</title>');
    expect(html).toContain('priority: high');
  });

  it('maps hyphenated and cancelled statuses', () => {
    const html = markup(
      renderTodoWriteArguments('{"todos":[{"content":"x","status":"in-progress"},{"content":"y","status":"cancelled"}]}'),
    );
    expect(html).toContain('in_progress');
    expect(html).toContain('cancelled');
  });

  it('returns fallback for malformed input', () => {
    expect(renderTodoWriteArguments('not json')).toEqual({ kind: 'fallback' });
    expect(renderTodoWriteArguments('{"todos":"nope"}')).toEqual({ kind: 'fallback' });
    expect(renderTodoWriteArguments('{"todos":[{"content":1}]}')).toEqual({ kind: 'fallback' });
    expect(renderTodoWriteArguments('{"todos":[]}')).toEqual({ kind: 'fallback' });
  });

  it('renders a non-empty result as a confirmation block and falls back on empty', () => {
    expect(markup(renderTodoWriteResult('Todos updated.'))).toContain('Todos updated.');
    expect(renderTodoWriteResult('')).toEqual({ kind: 'fallback' });
  });

  it('truncates an oversized argument body before parsing', () => {
    expect(renderTodoWriteArguments(oversizedValidJson)).toEqual({ kind: 'fallback' });
  });
});

describe('grep renderer (task 7.6)', () => {
  it('renders pattern and path', () => {
    const html = markup(renderGrepArguments('{"pattern":"foo","path":"src"}'));
    expect(html).toContain('/foo/');
    expect(html).toContain('src');
  });

  it('returns fallback when the pattern is missing', () => {
    expect(renderGrepArguments('{"path":"src"}')).toEqual({ kind: 'fallback' });
    expect(renderGrepArguments('not json')).toEqual({ kind: 'fallback' });
  });

  it('renders result rows as path, line, and content with structural marking', () => {
    const html = markup(renderGrepResult('src/a.ts:12:const foo = 1\nsrc/b.ts:7:foo()'));
    expect(html).toContain('a.ts');
    expect(html).toContain('b.ts');
    expect(html).toContain('const foo = 1');
    expect(html).toContain('foo()');
    // the line number is the structural mark — emphasised with a weight token,
    // not carried by colour alone
    expect(html).toContain('--weight-semibold');
    expect(html).toContain('>12<');
    expect(html).toContain('>7<');
  });

  it('renders bare line-number rows when the output has no path column', () => {
    const html = markup(renderGrepResult('3:const y = 2'));
    expect(html).toContain('const y = 2');
    expect(html).toContain('>3<');
  });

  it('renders non-matching lines verbatim', () => {
    const html = markup(renderGrepResult('──── separator ────'));
    expect(html).toContain('──── separator ────');
  });

  it('truncates an oversized result before parsing', () => {
    expect(renderGrepResult(oversizedValidJson)).toEqual({ kind: 'fallback' });
  });
});

describe('glob renderer (task 7.7)', () => {
  it('renders pattern with an optional base path', () => {
    const html = markup(renderGlobArguments('{"pattern":"**/*.ts","path":"src"}'));
    expect(html).toContain('**/*.ts');
    expect(html).toContain('src');
  });

  it('accepts a bare pattern string', () => {
    expect(markup(renderGlobArguments('**/*.md'))).toContain('**/*.md');
  });

  it('returns fallback for malformed input', () => {
    expect(renderGlobArguments('{}')).toEqual({ kind: 'fallback' });
    expect(renderGlobArguments('line one\nline two')).toEqual({ kind: 'fallback' });
  });

  it('renders result as monospace path rows', () => {
    const html = markup(renderGlobResult('src/a.ts\nsrc/b.ts'));
    expect(html).toContain('src/a.ts');
    expect(html).toContain('src/b.ts');
  });

  it('truncates an oversized result before parsing', () => {
    expect(renderGlobResult(oversizedValidJson)).toEqual({ kind: 'fallback' });
  });
});

describe('edit renderer (task 7.8)', () => {
  it('renders the path plus a diff whose rows carry their + / - sign', () => {
    const args = JSON.stringify({
      file_path: '/server/storage/writers.ts',
      old_string: 'line1\nold\nline3',
      new_string: 'line1\nnew\nline3',
      replace_all: true,
    });
    const html = markup(renderEditArguments(args));
    expect(html).toContain('writers.ts');
    expect(html).toContain('replace all');
    expect(html).toContain('tr-renderer-diff-add');
    expect(html).toContain('tr-renderer-diff-del');
    expect(html).toContain('>+</span>');
    expect(html).toContain('>-</span>');
    expect(html).toContain('old');
    expect(html).toContain('new');
  });

  it('returns fallback when either side of the edit is missing', () => {
    expect(renderEditArguments('{"file_path":"/a.ts","old_string":"x"}')).toEqual({ kind: 'fallback' });
    expect(renderEditArguments('{"file_path":"/a.ts","new_string":"x"}')).toEqual({ kind: 'fallback' });
    expect(renderEditArguments('not json')).toEqual({ kind: 'fallback' });
  });

  it('renders a non-empty result as a confirmation block and falls back on empty', () => {
    expect(markup(renderEditResult('The file /a.ts has been updated successfully.'))).toContain('has been updated');
    expect(renderEditResult('   ')).toEqual({ kind: 'fallback' });
  });

  it('truncates an oversized argument body before parsing', () => {
    expect(renderEditArguments(oversizedValidJson)).toEqual({ kind: 'fallback' });
  });
});

describe('write renderer (task 7.9)', () => {
  it('renders path plus content block', () => {
    const html = markup(renderWriteArguments('{"file_path":"/tmp/out.txt","content":"hello\\nworld"}'));
    expect(html).toContain('out.txt');
    expect(html).toContain('hello');
    expect(html).toContain('world');
  });

  it('returns fallback for malformed input', () => {
    expect(renderWriteArguments('{"file_path":"/a.txt"}')).toEqual({ kind: 'fallback' });
    expect(renderWriteArguments('{"content":"x"}')).toEqual({ kind: 'fallback' });
    expect(renderWriteArguments('not json')).toEqual({ kind: 'fallback' });
  });

  it('renders a non-empty result as a confirmation block and falls back on empty', () => {
    expect(markup(renderWriteResult('File created successfully at: /tmp/out.txt'))).toContain('File created successfully');
    expect(renderWriteResult('')).toEqual({ kind: 'fallback' });
  });

  it('truncates an oversized argument body before parsing', () => {
    expect(renderWriteArguments(oversizedValidJson)).toEqual({ kind: 'fallback' });
  });
});

describe('totality and bounds across every built-in (tasks 7.10 / 7.11)', () => {
  it('every renderer returns fallback for an oversized valid-JSON body without throwing', () => {
    for (const renderer of allRenderers) {
      expect(() => renderer.renderArguments(oversizedValidJson)).not.toThrow();
      expect(renderer.renderArguments(oversizedValidJson)).toEqual({ kind: 'fallback' });
      expect(() => renderer.renderResult(oversizedValidJson)).not.toThrow();
      expect(renderer.renderResult(oversizedValidJson)).toEqual({ kind: 'fallback' });
    }
  });

  it('every renderer returns fallback for an oversized non-JSON body without throwing', () => {
    const oversizedText = 'z'.repeat(RENDER_MAX_CHARS + 1);
    for (const renderer of allRenderers) {
      expect(() => renderer.renderArguments(oversizedText)).not.toThrow();
      expect(renderer.renderArguments(oversizedText)).toEqual({ kind: 'fallback' });
      expect(() => renderer.renderResult(oversizedText)).not.toThrow();
      expect(renderer.renderResult(oversizedText)).toEqual({ kind: 'fallback' });
    }
  });

  it('line-list renderers truncate at RENDER_MAX_LINES with an honest overflow note', () => {
    const manyLines = Array.from({ length: RENDER_MAX_LINES + 50 }, (_, i) => `line ${i}`).join('\n');
    expect(markup(renderBashResult(manyLines))).toContain('+50 more lines');
    expect(markup(renderReadResult(manyLines))).toContain('+50 more lines');
    expect(markup(renderGrepResult(manyLines))).toContain('+50 more lines');
    expect(markup(renderGlobResult(manyLines))).toContain('+50 more lines');
  });

  it('the edit diff truncates oversized sides at RENDER_MAX_LINES', () => {
    const args = JSON.stringify({
      file_path: '/a.ts',
      old_string: Array.from({ length: RENDER_MAX_LINES + 10 }, (_, i) => `old ${i}`).join('\n'),
      new_string: Array.from({ length: RENDER_MAX_LINES + 10 }, (_, i) => `new ${i}`).join('\n'),
    });
    const html = markup(renderEditArguments(args));
    expect(html).toContain('diff truncated at 200 lines per side');
  });
});
