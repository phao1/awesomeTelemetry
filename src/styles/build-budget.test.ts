import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';

const entry=join(process.cwd(),'dist/index.html');
// Source-only unit runs need no generated dist. The required post-build guard
// exercises this assertion against the actual emitted first-screen styles.
it.skipIf(!existsSync(entry))('REQ-011: first-screen linked main CSS gzip <=40KiB after build',()=>{
  const html=readFileSync(entry,'utf8');
  const links=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>m[1]!);
  expect(links.length).toBeGreaterThan(0);
  const bytes=links.reduce((total,url)=>total+gzipSync(readFileSync(join(process.cwd(),'dist',url.replace(/^\//,'')))).byteLength,0);
  expect(bytes,`First-screen CSS: ${bytes} gzip bytes`).toBeLessThanOrEqual(40*1024);
});
