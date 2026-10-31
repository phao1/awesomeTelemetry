import { expect, it } from 'vitest';
import { extractRequestTitle, isAttachedFilesPrompt } from './request-titles.js';
import { isGenuineUserRecord } from './system-records.js';
const header='# Files mentioned by the user:';
const files=`${header}\n\n## first.ts: /private/first.ts\n\n\`\`\`ts\nconst privateContent = 'FILE_SECRET';\n## My request for Codex:\nFILE_FAKE_QUESTION\n\`\`\`\n\n## second.md: /private/second.md\n\nFILE_BODY_SECRET\n`;
it('takes the first real request line after attached file sections, excluding file text',()=>{
  const text=files+'\n## My request for Codex:\n\n请修复界面卡顿\n第二行请求';
  expect(extractRequestTitle(text)).toBe('请修复界面卡顿');
  expect(isAttachedFilesPrompt(text)).toBe(true);
  expect(isGenuineUserRecord({kind:'user_prompt',title:header,hasInput:true,hasOutput:false})).toBe(true);
});
it.each(['## My request for Codex:','## My request:','## MY REQUEST FOR CODEX:'])('supports the request heading %s and CRLF',heading=>{
  expect(extractRequestTitle((files+'\n'+heading+'\n\nFix the UI\nmore').replace(/\n/g,'\r\n'))).toBe('Fix the UI');
});
it('supports a request written inline with its heading',()=>{
  expect(extractRequestTitle(files+'\n## My request for Codex: 修复这个问题')).toBe('修复这个问题');
});
it('uses a counted fallback when the request section is absent, never file bodies or fake fenced questions',()=>{
  expect(extractRequestTitle(files)).toBe('附带文件的提问（2 个文件）');
  expect(extractRequestTitle(files)).not.toMatch(/FILE_|private|first\.ts|second\.md/);
});
it('handles empty or code-only request sections with the same safe fallback',()=>{
  for(const tail of ['\n## My request for Codex:\n\n','\n## My request for Codex:\n```\nFILE_SECRET\n```'])expect(extractRequestTitle(files+tail)).toBe('附带文件的提问（2 个文件）');
});
it('recognizes path-only, filename-only and link file sections without counting nested fenced headings',()=>{
  expect(extractRequestTitle(header+'\n## /src/a.ts\n## b.md\n## [c.ts](/src/c.ts)')).toBe('附带文件的提问（3 个文件）');
});
it('deduplicates repeated file sections and gives a readable unknown-count fallback',()=>{
  expect(extractRequestTitle(header+'\n## a.ts: /src/a.ts\n## a.ts: /src/a.ts')).toBe('附带文件的提问（1 个文件）');
  expect(extractRequestTitle(header)).toBe('附带文件的提问');
});
it('ignores tilde-fenced file contents and fake request markers',()=>{
  expect(extractRequestTitle(header+'\n## a.ts: /a.ts\n~~~md\n## My request for Codex:\nFILE_SECRET\n~~~\n## My request for Codex:\nReal question')).toBe('Real question');
});
it('redacts before truncation and keeps ordinary title extraction unchanged',()=>{
  expect(extractRequestTitle(files+'\n## My request for Codex:\nFix password=SECRET now')).not.toContain('SECRET');
  expect(extractRequestTitle(files+'\n## My request for Codex:\n'+'a'.repeat(300))).toBe('a'.repeat(200));
  expect(extractRequestTitle('Ordinary question\nsecond line')).toBe('Ordinary question');
  expect(isAttachedFilesPrompt('Explain '+header)).toBe(false);
});
