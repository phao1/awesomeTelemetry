import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Proxy } from 'http-mitm-proxy';

/** Own all sockets/listeners, including dynamically created CONNECT TLS servers.
 * The _createHttpsServer adapter is verified against installed v1.1.0 source/types.
 * Raw Proxy.close() neither waits for sockets nor prevents a late TLS bind.
 */
export class TransportLifecycle {
  private readonly servers = new Set<Server>();
  private readonly sockets = new Set<Socket>();
  private readonly websockets = new Set<NonNullable<Proxy['wsServer']>>();
  private readonly closures = new Map<Server, Promise<void>>();
  private pendingTls = 0;
  stopping = false;
  private readonly proxy: Proxy;
  private readonly ownsHttpsAgent: boolean;

  constructor(proxy: Proxy, ownsHttpsAgent: boolean, onListenError: (error: Error) => void) {
    this.proxy = proxy;
    this.ownsHttpsAgent = ownsHttpsAgent;
    // v1.1.0 assigns httpServer only after async CA creation and does not
    // subscribe to its bind error. Attach before its immediate listen() call.
    let httpServer = proxy.httpServer;
    Object.defineProperty(proxy, 'httpServer', {
      configurable: true, enumerable: true,
      get: () => httpServer,
      set: (server: Proxy['httpServer']) => {
        httpServer = server;
        if (server !== undefined) {
          server.on('error', onListenError);
          this.track(server);
        }
      },
    });
    const createTls = proxy._createHttpsServer.bind(proxy);
    proxy._createHttpsServer = (options, callback) => {
      if (this.stopping) throw new Error('PROXY_STOPPED');
      this.pendingTls += 1;
      try {
        createTls(options, (port, server, ws) => {
          this.pendingTls -= 1;
          this.track(server, ws);
          if (!this.stopping) callback(port, server, ws);
        });
      } catch (error) {
        this.pendingTls -= 1;
        throw error;
      }
    };
  }

  track(server: Server | undefined, ws?: Proxy['wsServer']): void {
    if (server !== undefined && !this.servers.has(server)) {
      this.servers.add(server);
      server.on('connection', socket => {
        if (this.stopping) { socket.destroy(); return; }
        this.sockets.add(socket);
        socket.once('close', () => this.sockets.delete(socket));
      });
      if (this.stopping) this.closeServer(server);
    }
    if (ws !== undefined) {
      this.websockets.add(ws);
      if (this.stopping) this.closeWebsocket(ws);
    }
  }

  beginStop(): void {
    this.stopping = true;
    this.track(this.proxy.httpServer, this.proxy.wsServer);
    this.track(this.proxy.httpsServer, this.proxy.wssServer);
    for (const server of this.servers) this.closeServer(server);
    for (const ws of this.websockets) this.closeWebsocket(ws);
  }

  async finishStop(): Promise<void> {
    this.proxy.httpAgent?.destroy();
    if (this.ownsHttpsAgent) this.proxy.httpsAgent?.destroy();
    for (const socket of this.sockets) socket.destroy();
    // A TLS server may have started creating just before beginStop(). track()
    // closes it as soon as listen completes; no new creation can begin now.
    while (this.pendingTls > 0 || this.sockets.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await Promise.all(this.closures.values());
  }

  private closeServer(server: Server): void {
    if (this.closures.has(server)) return;
    const closed = new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error !== undefined && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      });
    });
    // Retain rejection for finishStop(), without an early unhandled rejection.
    void closed.catch(() => {});
    this.closures.set(server, closed);
  }

  private closeWebsocket(ws: NonNullable<Proxy['wsServer']>): void {
    for (const client of ws.clients) client.terminate();
    ws.close();
  }
}
