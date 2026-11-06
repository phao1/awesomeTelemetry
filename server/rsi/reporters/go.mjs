import process from 'node:process';
import console from 'node:console';
// go test -json is the trusted Go report producer. Parser lives on the host.
// This launcher keeps compiler/startup errors distinguishable from test failures.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child = spawn('go', ['test', '-json', '-count=1', ...process.argv.slice(2)], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
let stderrBytes = 0;
child.stderr.on('data', b => { stderrBytes += b.length; if (stderrBytes > 1048576) child.kill('SIGKILL'); });
child.on('error', () => { process.exitCode = 125; });
for await (const line of createInterface({ input: child.stdout })) {
  try {
    const event = JSON.parse(line);
    if (event.Action && ['run', 'pass', 'fail', 'skip'].includes(event.Action)) {
      console.log(JSON.stringify({ Action: event.Action, Package: event.Package, ...(event.Test ? { Test: event.Test } : {}) }));
    }
  } catch { process.exitCode = 125; child.kill('SIGKILL'); }
}
child.on('close', code => { process.exitCode = process.exitCode || (stderrBytes > 1048576 ? 125 : code ?? 125); });
