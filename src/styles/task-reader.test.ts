import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('contains partial summaries and long model names within a 375px reading width', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/task-reader.css'), 'utf8');
  expect(css).toMatch(/\.task-summary-bar\s*\{[^}]*display:flex[^}]*flex-wrap:wrap[^}]*min-width:0[^}]*max-width:100%/);
  expect(css).toMatch(/\.task-summary-bar>div\s*\{[^}]*flex-wrap:wrap[^}]*min-width:0[^}]*max-width:100%[^}]*overflow-wrap:anywhere/);
  expect(css).toMatch(/\.task-summary-bar dd\s*\{[^}]*min-width:0[^}]*overflow-wrap:anywhere/);
});
it('uses measured multi-line grid rows at 375px without dropping preview, status or evidence', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/task-ledger.css'), 'utf8');
  const narrow = css.slice(css.indexOf('/* 375px reading:'));
  expect(narrow).toContain('@media(max-width:40rem)');
  expect(narrow).toMatch(/\.process-record-line\s*\{[^}]*display:grid[^}]*minmax\(0,1fr\)[^}]*height:auto[^}]*max-width:100%/);
  expect(narrow).toMatch(/\.process-record-line>\*\s*\{[^}]*min-width:0[^}]*max-width:100%/);
  expect(narrow).toMatch(/\.process-tool-preview\s*\{[^}]*grid-column:2\/-1[^}]*grid-row:2[^}]*max-width:100%[^}]*overflow:hidden[^}]*text-overflow:ellipsis/);
  expect(narrow).toMatch(/\.process-tool-status\s*\{[^}]*grid-column:4[^}]*grid-row:3/);
  expect(narrow).toMatch(/\.process-pair-evidence,.*\.process-record-evidence\s*\{[^}]*grid-column:5[^}]*grid-row:3/);
  expect(narrow).not.toContain('display:none');
});
