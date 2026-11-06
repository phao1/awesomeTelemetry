import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { candidateDiff, git } from './build.js';
import { privateWrite } from './artifacts.js';
import type { RsiStore } from './queue.js';
import { conflict } from './reader.js';
export async function adopt(store: RsiStore, iterationId: string): Promise<void> {
  const i = store.list('iteration_put').find(i => i.id === iterationId);
  if (!i || i.state !== 'promoted' || !store.list('evaluation_put').some(e => e.commit === i.commit && e.phase === 'final' && e.state === 'completed' && e.locked && e.infraErrorRatio === 0 && e.score !== null)) return conflict();
  const mirror = join(store.root, 'private/repository.git'), ref = `refs/rsi/adopted/${i.seq}`;
  await git(['--git-dir', mirror, 'update-ref', ref, i.commit]);
  const file=join(store.root, `artifacts/adopted/${i.seq}.patch`);
  await privateWrite(`${file}.tmp`, await candidateDiff(mirror, store.task().baselineCommit, i.commit));
  await rename(`${file}.tmp`,file);
}
