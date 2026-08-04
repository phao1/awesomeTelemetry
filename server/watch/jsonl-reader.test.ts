import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { headHash, readJsonlFrom } from './jsonl-reader.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'watch-jsonl-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('REQ-008 JSONL 尾部增量读', () => {
  it('REQ-008 全量读取返回全部行与 endOffset', async () => {
    const path = join(tempDir(), 'a.jsonl');
    writeFileSync(path, '{"n":1}\n{"n":2}\n{"n":3}\n');

    const r = await readJsonlFrom(path, 0);
    expect(r.rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(r.endOffset).toBe('{"n":1}\n{"n":2}\n{"n":3}\n'.length);
    expect(r.fellBack).toBe(false);
  });

  it('REQ-008 append 一行后只读增量部分，endOffset 正确推进', async () => {
    const path = join(tempDir(), 'b.jsonl');
    writeFileSync(path, '{"n":1}\n{"n":2}\n');
    const first = await readJsonlFrom(path, 0);

    writeFileSync(path, '{"n":1}\n{"n":2}\n{"n":3}\n');
    const second = await readJsonlFrom(path, first.endOffset);

    expect(second.rows).toEqual([{ n: 3 }]);
    expect(second.endOffset).toBeGreaterThan(first.endOffset);
    expect(second.endOffset).toBe('{"n":1}\n{"n":2}\n{"n":3}\n'.length);
    expect(second.fellBack).toBe(false);
  });

  it('REQ-008 文件被截断时回退全量', async () => {
    const path = join(tempDir(), 'c.jsonl');
    writeFileSync(path, '{"n":1}\n{"n":2}\n{"n":3}\n{"n":4}\n{"n":5}\n');
    const prevOffset = '{"n":1}\n{"n":2}\n{"n":3}\n{"n":4}\n{"n":5}\n'.length;

    // 截断成两行
    writeFileSync(path, '{"n":1}\n{"n":2}\n');
    const r = await readJsonlFrom(path, prevOffset);

    expect(r.fellBack).toBe(true);
    expect(r.rows).toEqual([{ n: 1 }, { n: 2 }]);
    expect(r.endOffset).toBe('{"n":1}\n{"n":2}\n'.length);
  });

  it('REQ-008 首 4KB hash 变化时回退全量', async () => {
    const path = join(tempDir(), 'd.jsonl');
    writeFileSync(path, '{"n":1}\n{"n":2}\n{"n":3}\n');
    const prevHead = headHash(path);

    // 重写文件（头部变化）
    writeFileSync(path, '{"x":9}\n{"n":2}\n{"n":3}\n');
    const r = await readJsonlFrom(path, 5, { prevHeadHash: prevHead });

    expect(r.fellBack).toBe(true);
    expect(r.rows).toEqual([{ x: 9 }, { n: 2 }, { n: 3 }]);
  });

  it('REQ-008 末尾未换行的部分行不计入，endOffset 停在最后完整行后', async () => {
    const path = join(tempDir(), 'e.jsonl');
    const partial = '{"n":1}\n{"n":2}\n{"partial":true}';
    writeFileSync(path, partial);

    const r = await readJsonlFrom(path, 0);
    expect(r.rows).toEqual([{ n: 1 }, { n: 2 }]);
    expect(r.endOffset).toBe('{"n":1}\n{"n":2}\n'.length);
  });

  it('REQ-008 坏 JSON 行跳过但 endOffset 仍推进', async () => {
    const path = join(tempDir(), 'f.jsonl');
    writeFileSync(path, '{"n":1}\nnot-json\n{"n":3}\n');

    const r = await readJsonlFrom(path, 0);
    expect(r.rows).toEqual([{ n: 1 }, { n: 3 }]);
    expect(r.endOffset).toBe('{"n":1}\nnot-json\n{"n":3}\n'.length);
  });
});
