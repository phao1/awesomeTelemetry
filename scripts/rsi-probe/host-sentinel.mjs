// Claude runs this on the host outside the sandbox. No files/credentials exposed.
import http from 'node:http';
const port = Number(process.env.RSI_HOST_PORT ?? '18765');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid RSI_HOST_PORT');
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' }); res.end('rsi-host-sentinel\n');
});
server.on('error', error => { console.error(JSON.stringify({ error: error.code, port })); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ listening: '127.0.0.1', port })));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
