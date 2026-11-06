import { describe, expect, it } from 'vitest';
import { packFiles, relativePath, unpackFiles } from './artifacts.js';
describe('tar trust boundary', () => {
  it('round trips binary contents with normalized ownership and modes', () => {
    const files = new Map([['sub/file', Buffer.from([0, 255, 10])]]), tar = packFiles(files);
    expect(unpackFiles(tar)).toEqual(files); expect(tar.subarray(100, 108).toString()).toBe('0000644\0');
  });
  it.each(['../escape', '/root', 'x/../escape', 'x\\y', 'C:/escape', './file'])('rejects %s', value => expect(() => relativePath(value)).toThrow());
  it('rejects corrupt checksums', () => { const tar = packFiles(new Map([['file', Buffer.from('x')]])); tar[0] = 90; expect(() => unpackFiles(tar)).toThrow('checksum'); });
});
