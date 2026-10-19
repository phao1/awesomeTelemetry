import { parentPort } from 'node:worker_threads';
parentPort.on('message', async message => {
  if (message.input.hostname === 'crash.synthetic.invalid') throw new Error('synthetic sensitive payload must never reach application errors');
  if (message.input.hostname === 'recover.synthetic.invalid') {
    const { projectCapture } = await import('../../server-dist/capture-worker.js');
    parentPort.postMessage({ id: message.id, result: await projectCapture(message.input) });
  }
  // Deliberately stalled worker for bounded deadline/cleanup fault tests.
});
