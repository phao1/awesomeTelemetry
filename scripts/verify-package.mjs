import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { excludedPackagePath, requiredBuildFiles, rsiPackageAssets } from './rsi-package-assets.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const foldingFixtures = [
  'data/agent-folding/manifest.json',
  'data/agent-folding/support-desk-project.json',
  'data/agent-folding/support-desk/fixture.json',
  'data/agent-folding/single-agent-loop-kit/LICENSE',
];
const required = [...requiredBuildFiles, ...rsiPackageAssets, ...foldingFixtures, 'bin/agent-observe.js'];
const buildTrees = [
  ['dist', path => !path.endsWith('.map')],
  ['server-dist', path => path.endsWith('.js')],
  ['data/agent-folding', () => true],
];
const treePatterns = ['dist/**', '!dist/**/*.map', 'server-dist/**/*.js', 'data/agent-folding/**'];
const rootFiles = ['LICENSE', 'README.md', 'package.json'];

function missing(path) {
  return new Error(`Missing package artifact ${path}. Run npm install then npm run build before npm pack. Packing never rebuilds.`);
}

function requireFile(root, path) {
  const file = resolve(root, path);
  if (!existsSync(file)) throw missing(path);
  if (!lstatSync(file).isFile() || realpathSync(file) !== file) throw new Error(`Package artifact must be a regular file: ${path}`);
  return file;
}

function treeFiles(root, directory, include) {
  if (realpathSync(resolve(root, directory)) !== resolve(root, directory)) throw new Error(`Package directory must not be a link: ${directory}`);
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return treeFiles(root, path, include);
    return include(path) ? [path] : [];
  });
}

/** Validate build and runtime inputs and return the files to copy into a binary distribution. */
export function verifyPackage(directory = defaultRoot) {
  const root = realpathSync(directory);
  for (const path of required) requireFile(root, path);
  const manifest = JSON.parse(readFileSync(requireFile(root, 'package.json'), 'utf8'));
  if (manifest.private !== true) throw new Error('Package must remain private until publication is confirmed');
  if (!treePatterns.every(path => manifest.files.includes(path))) throw new Error('Missing package build tree in package.json files');
  const assets = manifest.files.filter(path => !treePatterns.includes(path));
  for (const path of [...rsiPackageAssets, ...Object.values(manifest.bin)]) {
    if (!assets.includes(path.replace(/^\.\//, ''))) throw new Error(`Missing npm allowlist entry: ${path}`);
  }
  const files = [...new Set([...rootFiles, ...assets, ...buildTrees.flatMap(([dir, include]) => treeFiles(root, dir, include))])];
  for (const path of files) {
    if (path.startsWith('/') || /[*!?\\]/.test(path) || path.split('/').some(part => part === '..' || part === '.') || excludedPackagePath(path)) {
      throw new Error(`Unexpected package artifact: ${path}`);
    }
    requireFile(root, path);
  }
  const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) {
    if (!files.includes(`dist${match[1]}`)) throw new Error(`Missing frontend asset ${match[1]}`);
  }
  if (!files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js'))) throw new Error('Missing built frontend JavaScript');
  const knownFiles = new Set(files);
  for (const file of files.filter(path => path.startsWith('server-dist/'))) {
    const source = readFileSync(resolve(root, file), 'utf8');
    const imports = /^(?:import|export)\s+(?:[^\n]*?\sfrom\s+)?['"](\.\.?\/[^'"]+\.js)['"]|\bimport\(['"](\.\.?\/[^'"]+\.js)['"]\)/gm;
    for (const match of source.matchAll(imports)) {
      const dependency = posix.join(posix.dirname(file), match[1] ?? match[2]);
      if (!knownFiles.has(dependency)) throw missing(dependency);
    }
  }
  return files;
}

if (process.argv[1] && existsSync(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  verifyPackage();
  console.log('Package build artifacts verified (no rebuild). Publication remains disabled until package ownership is confirmed.');
}
