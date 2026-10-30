import { expect, it } from 'vitest';
import { parseTaskHealthArgs } from './cli.js';
it('uses read-only stdout formats and explicit DB/member options', () => {
  expect(parseTaskHealthArgs(['collected:one', '--member', 'main', '--format', 'md', '--db', '/tmp/existing.sqlite'])).toEqual({ taskId: 'collected:one', member: 'main', format: 'md', db: '/tmp/existing.sqlite' });
  expect(parseTaskHealthArgs(['collected:one'])).toMatchObject({ member: 'all', format: 'json' });
});
it.each([[], ['--db'], ['task', '--write', 'yes'], ['task', '--format', 'html'], ['task', '--member'], ['task', '--db', 'a', '--db', 'b']])('rejects invalid args %j', (...args) => { expect(() => parseTaskHealthArgs(args as string[])).toThrow(); });
it('runs the packaged CLI against an existing DB without writes, scans, report files or non-JSON stdout', async () => {
  const [{ default: Database }, { initSchema }, fs, { tmpdir }, path, { build }, { execFile }, { promisify }, { createHash }] = await Promise.all([
    import('better-sqlite3'), import('../storage/schema.js'), import('node:fs/promises'), import('node:os'), import('node:path'), import('vite'), import('node:child_process'), import('node:util'), import('node:crypto'),
  ]);
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'health-cli-'));
  try {
    const dbPath = path.join(directory, 'existing.sqlite'), db = new Database(dbPath), when = '2026-10-30T00:00:00.000Z'; initSchema(db);
    db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES('root','codex','Codex','Task',?,?, '/no-scan.jsonl',1)").run(when, when);
    db.prepare("INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,actor) VALUES('root','e',0,'user_prompt','understand','Task',?,'user')").run(when); db.close();
    const before = createHash('sha256').update(await fs.readFile(dbPath)).digest('hex'), mtime = (await fs.stat(dbPath)).mtimeMs;
    await build({ configFile: false, logLevel: 'silent', build: { ssr: path.resolve('server/task-health/cli.ts'), outDir: path.join(directory, 'server-dist/task-health'), rollupOptions: { external: ['better-sqlite3'], output: { entryFileNames: 'cli.js' } } } });
    await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module"}'); await fs.symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir');
    await fs.mkdir(path.join(directory, 'bin')); await fs.copyFile('bin/task-health.js', path.join(directory, 'bin/task-health.js'));
    const files = await fs.readdir(directory), { stdout, stderr } = await promisify(execFile)(process.execPath, [path.join(directory, 'bin/task-health.js'), 'collected:root', '--db', dbPath]);
    expect(stderr).toBe(''); expect(JSON.parse(stdout)).toMatchObject({ taskId: 'collected:root', mode: 'standard' });
    expect(createHash('sha256').update(await fs.readFile(dbPath)).digest('hex')).toBe(before); expect((await fs.stat(dbPath)).mtimeMs).toBe(mtime); expect(await fs.readdir(directory)).toEqual(files);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
