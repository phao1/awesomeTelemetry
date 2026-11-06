import { mkdir, readdir, readFile, lstat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export const ARTIFACT_LIMIT = 64 * 1024 * 1024;
export function relativePath(value: string): string {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/')
    || /^[a-z]:/i.test(value) || value.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('Unsafe artifact path');
  return value;
}
export async function privateWrite(file: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, data, { mode: 0o600 });
}
export async function treeFiles(root: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    relativePath(name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Unsupported bank/build file');
    if (entry.isDirectory()) paths.push(...await treeFiles(root, name));
    else paths.push(name);
  }
  return paths;
}

/** USTAR, normalized ownership/modes: host 0600 files remain readable by container user. */
export function packFiles(files: Map<string, Buffer>): Buffer {
  const chunks: Buffer[] = []; let total = 1024;
  for (const [raw, data] of files) {
    const name = relativePath(raw), header = Buffer.alloc(512);
    let leaf = name, prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const at = name.lastIndexOf('/'); prefix = name.slice(0, at); leaf = name.slice(at + 1);
      if (at < 0 || Buffer.byteLength(prefix) > 155 || Buffer.byteLength(leaf) > 100) throw new Error('Tar path too long');
    }
    header.write(leaf, 0, 100); header.write('0000644\0', 100, 8);
    header.write('0000000\0', 108, 8); header.write('0000000\0', 116, 8);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    header.write('00000000000\0', 136, 12); header.fill(32, 148, 156); header[156] = 48;
    header.write('ustar\0', 257, 6); header.write('00', 263, 2); header.write(prefix, 345, 155);
    const checksum = header.reduce((n, b) => n + b, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    const padding = Buffer.alloc((512 - data.length % 512) % 512);
    total += 512 + data.length + padding.length;
    if (total > ARTIFACT_LIMIT) throw new Error('Artifact limit exceeded');
    chunks.push(header, data, padding);
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
export async function packTree(root: string): Promise<Buffer> {
  const files = new Map<string, Buffer>(); let size = 0;
  for (const name of await treeFiles(root)) {
    const stat = await lstat(join(root, name)); size += stat.size;
    if (size > ARTIFACT_LIMIT) throw new Error('Artifact limit exceeded');
    files.set(name, await readFile(join(root, name)));
  }
  return packFiles(files);
}

/** Exported session archives are untrusted; links, devices and traversal fail closed. */
export function unpackFiles(tar: Buffer, sourceArchive = false): Map<string, Buffer> {
  if (tar.length > (sourceArchive ? 256 * 1024 * 1024 : ARTIFACT_LIMIT)) throw new Error('Artifact limit exceeded');
  const files = new Map<string, Buffer>(), links = new Map<string, string>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const h = tar.subarray(offset, offset + 512); offset += 512;
    if (h.every(b => b === 0)) break;
    const str = (at: number, n: number): string => h.subarray(at, at + n).toString('utf8').replace(/\0.*$/s, '');
    const checksum = Number.parseInt(str(148, 8).trim(), 8);
    const copy = Buffer.from(h); copy.fill(32, 148, 156);
    if (copy.reduce((n, b) => n + b, 0) !== checksum) throw new Error('Invalid tar checksum');
    const size = Number.parseInt(str(124, 12).trim(), 8), type = str(156, 1);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > tar.length) throw new Error('Invalid tar size');
    // Git archive may contain a global PAX commit header; it carries no file payload.
    if (type !== 'g') {
      const name = [str(345, 155), str(0, 100)].filter(Boolean).join('/').replace(/^\.\//, '').replace(/\/$/, '');
      if (type === '5' && (name === '' || name === '.')) { /* root directory */ }
      else {
        relativePath(name);
        if (type === '2' && sourceArchive) { links.set(name, str(157, 100)); }
        else if (type !== '5' && type !== '0' && type !== '') throw new Error('Unsupported tar entry');
        if (type !== '5' && type !== '2') {
          if (files.has(name)) throw new Error('Duplicate tar entry');
          files.set(name, Buffer.from(tar.subarray(offset, offset + size)));
        }
      }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  // Only source archives may contain inherited symlinks. Materialize targets
  // from this archive, never follow host links. Candidate symlink diffs reject in L1.
  function materialize(name: string, seen: Set<string>): Buffer {
    if (seen.has(name)) throw new Error('Cyclic source symlink');
    const data = files.get(name); if (data) return data;
    const link = links.get(name); if (!link || link.startsWith('/')) throw new Error('Unsafe source symlink');
    seen.add(name);
    const target = resolve('/', dirname(name), link).slice(1);
    const result = materialize(target, seen); files.set(name, result); return result;
  }
  for (const name of links.keys()) materialize(name, new Set());
  return files;
}
export async function extractFiles(tar: Buffer, root: string, sourceArchive = false): Promise<void> {
  for (const [name, data] of unpackFiles(tar, sourceArchive)) {
    const file = resolve(root, name);
    if (!file.startsWith(`${resolve(root)}${sep}`)) throw new Error('Unsafe export path');
    await privateWrite(file, data);
  }
}
