import { Readable, Writable } from 'node:stream';

// Transport and HTTP stream doubles only; handlers, SSE parsing and budget logic are real.
export function request(body, { token = 'temporary', stream = true, ...options } = {}) {
  const req = Readable.from([JSON.stringify({ messages: [], stream, ...body })]);
  req.method = 'POST'; req.url = '/v1/chat/completions';
  req.headers = { authorization: `Bearer ${token}` };
  return Object.assign(req, options);
}
export function response() {
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; res.headersSent = true; };
  res.body = () => Buffer.concat(chunks).toString('utf8');
  return res;
}
export function upstream(body, statusCode = 200) {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode });
}
