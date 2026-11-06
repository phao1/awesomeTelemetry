import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
const blocked = new BlockList(), blocked6 = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['192.0.2.0',24],['192.88.99.0',24],['198.51.100.0',24],['203.0.113.0',24],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix,'ipv4');
for (const [address,prefix] of [['::',96],['::ffff:0:0',96],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32],['64:ff9b::',96],['2002::',16],['2001::',32],['fec0::',10],['3ffe::',16]]) blocked6.addSubnet(address,prefix,'ipv6');
export function publicAddress(address) {
  const version = isIP(address);
  if (version === 6) { const first=parseInt(address.split(':')[0],16);if(!Number.isFinite(first)||first<0x2000||first>0x3fff)return false; }
  return version !== 0 && !(version === 4 ? blocked : blocked6).check(address, version === 4 ? 'ipv4' : 'ipv6');
}
export function connectHost(authority, domains) {
  const match = /^([a-z0-9]+(?:[.-][a-z0-9]+)*):443$/i.exec(authority ?? '');
  if (!match || isIP(match[1]) || !domains.some(d => d.toLowerCase() === match[1].toLowerCase())) return null;
  return match[1].toLowerCase();
}
function reject(res,status,code) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({error:{code,message:'Sidecar request rejected'}})); }
export function createSidecar({ modelHandler, agentBase, domains = [], resolve = lookup, request = http.request, connect = net.connect }) {
  const base = agentBase ? new URL(agentBase) : null;
  if (base && (base.protocol !== 'http:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash)) throw new Error('Invalid platform origin');
  const server = http.createServer(async (req,res) => {
    let path;
    try { path = new URL(req.url, 'http://sidecar').pathname; } catch { reject(res,404,'RSI_NOT_FOUND'); return; }
    if (base && path.startsWith('/api/rsi/agent/') && req.url.startsWith('/api/rsi/agent/') && !/[\\]|%2f|%5c|%2e/i.test(req.url)) {
      if(req.method==='GET'&&(Number(req.headers['content-length']??0)>0||req.headers['transfer-encoding']!==undefined)){req.resume?.();reject(res,400,'RSI_INVALID_REQUEST');return;}
      if (!['GET','POST'].includes(req.method)) { reject(res,404,'RSI_NOT_FOUND'); return; }
      const headers = { host: `127.0.0.1:${base.port || 80}`, ...(typeof req.headers.authorization === 'string' ? { authorization: req.headers.authorization } : {}), ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) };
      const upstream = request(new URL(req.url, base), { method: req.method, headers }, response => {
        res.writeHead(response.statusCode ?? 502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        let size = 0; response.on('data', chunk => { size += chunk.length; if (size > 1048576) { response.destroy(); res.destroy(); } else res.write(chunk); });
        response.on('end', () => res.end()); response.on('error', () => res.destroy());
      });
      const timer = setTimeout(() => upstream.destroy(), 15000); timer.unref();
      upstream.on('close', () => clearTimeout(timer)); upstream.on('error', () => { if (!res.headersSent) reject(res,502,'INTERNAL_ERROR'); else res.end(); });
      res.on('close', () => upstream.destroy());
      let size = 0;
      req.on('data', chunk => { size += chunk.length; if (size > 65536) { upstream.destroy(); if (!res.headersSent) reject(res,413,'RSI_LIMIT'); else res.end(); } else upstream.write(chunk); });
      req.on('end', () => upstream.end()); req.on('error', () => upstream.destroy());
      return;
    }
    if (path.startsWith('/api/') || !['/v1/chat/completions','/health'].includes(req.url)) { reject(res,404,'RSI_NOT_FOUND'); return; }
    try { await modelHandler(req,res); } catch { if (!res.headersSent) reject(res,502,'INTERNAL_ERROR'); else res.end(); }
  });
  server.on('connect', async (req, socket, head) => {
    socket.on('error',()=>socket.destroy());
    const host = connectHost(req.url, domains);
    if (!host) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    try {
      const addresses = await resolve(host, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(v => !publicAddress(v.address))) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const destination = addresses[0];
      const upstream = connect({ host: destination.address, family: destination.family, port: 443 });
      socket.setTimeout(120000, () => socket.destroy()); upstream.setTimeout(120000, () => upstream.destroy());
      upstream.once('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
      socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy()); upstream.on('error', () => socket.destroy()); upstream.on('close', () => socket.destroy());
    } catch { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); }
  });
  return server;
}
