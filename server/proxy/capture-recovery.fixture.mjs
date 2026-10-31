// Bundled by the adjacent test; a real process, actual proxy/store/server and copied production worker.
import { once } from 'node:events';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openWritable } from '../storage/db.js';
import { parseCliArgs, runStartupSelfCheck } from '../cli.js';
import { createAgentObservabilityServer } from '../server.js';
import { CaptureBodyStore } from './body-store.js';
import { CaptureJournal } from './capture-journal.js';
import { createMitmProxy } from './mitm-proxy.js';
import { eventBus } from '../realtime/event-bus.js';

const [directory, mode, injectFault] = process.argv.slice(2);
const dbPath = join(directory, 'state.sqlite'), captureDirectory = join(directory, 'bodies'), db = openWritable(dbPath);
const countRequests = db.prepare('SELECT COUNT(*) AS n FROM proxy_requests');
if (injectFault === 'retention') runStartupSelfCheck(db, parseCliArgs(['--db-path', dbPath, '--config-root', directory, '--proxy-retention-days', '1', '--no-open']));
if (injectFault === 'fail') db.exec("CREATE TRIGGER reject_capture BEFORE INSERT ON proxy_requests BEGIN SELECT RAISE(ABORT, 'controlled final commit failure'); END");
if (injectFault === 'repair') db.exec('DROP TRIGGER IF EXISTS reject_capture');
if (injectFault === 'corrupt') {
  const faultStore = await CaptureBodyStore.create(captureDirectory), faultJournal = await CaptureJournal.open(db, faultStore);
  await writeFile(join(faultJournal.directory, randomUUID() + '.json'), '{controlled-corrupt-journal');
}
let proxy, server, store, journal, savedEvents = 0;
const statusRequestCounts = [];
const unsubscribe = eventBus.on('proxy_status', value => { statusRequestCounts.push(value.requestCount); });
if (mode === 'proxy') {
  store = await CaptureBodyStore.create(captureDirectory); journal = await CaptureJournal.open(db, store);
  proxy = await createMitmProxy({ db, bodyStore: store, port: 0, caDirectory: join(directory, 'ca'), notify: () => { savedEvents += 1; } });
  process.send?.({ type: 'ready', port: proxy.httpPort });
} else {
  server = createAgentObservabilityServer({ db, dbPath, captureDirectory, proxyRetentionDays: injectFault === 'retention' ? 1 : 0, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json'),
    config: { prewarmRecent: 0, traeKeyPath: null, providers: {} } });
  const listening = once(server, 'listening'); server.listen(0, '127.0.0.1'); await listening;
  process.send?.({ type: 'ready', port: server.address().port });
}
process.on('message', async message => {
  try {
    if (message === 'probe') {
      await journal?.drain();
      const entries = journal === undefined ? [] : await Promise.all((await readdir(journal.directory)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(journal.directory, name), 'utf8'))));
      const files = store === undefined ? [] : await Promise.all((await readdir(store.directory)).filter(name => /\.(body|part)$/.test(name)).map(async name => ({ name, bytes: (await stat(join(store.directory, name))).size })));
      process.send?.({ type: 'probe', savedEvents, statusRequestCounts, activity: proxy?.captureActivity(), storage: store?.status(), entries, files, rows: countRequests.get().n });
    }
    if (message === 'quit') {
      await proxy?.shutdown({ graceMs: 0 });
      if (server !== undefined) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      const check = db.pragma('quick_check', { simple: true }); unsubscribe(); db.close(); process.send?.({ type: 'closed', check }); process.disconnect();
    }
  } catch { process.send?.({ type: 'failure', code: 'CONTROLLED_FIXTURE_FAILED' }); }
});
process.once('disconnect', () => process.exit(0));
