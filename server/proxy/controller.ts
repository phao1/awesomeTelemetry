import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { Database } from 'better-sqlite3';

import type { BusEvents } from '../../src/core/trace-types.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import {
  discoverFridaTarget,
  runFridaMonitor,
  type FridaCaptureData,
} from './frida-capture.js';
import { createMitmProxy, type ProxyServerLike } from './mitm-proxy.js';

/**
 * T-12（contracts/api.md §4/§5）：Proxy / Frida 控制路由的运行时。
 * design.md D4：启动是重活，MUST NOT 阻塞 HTTP handler——start 立即返回
 * `starting` 中间态，就绪/失败由 SSE（proxy_status / frida_status）通知。
 */

export type ProxyPhase = 'idle' | 'starting' | 'running';

export interface ProxyStatus {
  running: boolean;
  starting: boolean;
  port: number | null;
  requestCount: number;
  startedAt: string | null;
}

export interface FridaStatus {
  running: boolean;
  starting: boolean;
  pid: number | null;
}

export class ProxyStateError extends Error {
  readonly code: 'PROXY_ALREADY_RUNNING' | 'PROXY_NOT_RUNNING';

  constructor(code: 'PROXY_ALREADY_RUNNING' | 'PROXY_NOT_RUNNING', message: string) {
    super(message);
    this.code = code;
    this.name = 'ProxyStateError';
  }
}

export class FridaTargetError extends Error {
  readonly code = 'FRIDA_TARGET_NOT_FOUND' as const;

  constructor(message: string) {
    super(message);
    this.name = 'FridaTargetError';
  }
}

const COUNT_PROXY_REQUESTS_SQL = 'SELECT COUNT(*) AS c FROM proxy_requests';

export interface ProxyRuntimeDeps {
  /** 测试注入：默认 createMitmProxy。 */
  createProxy?: typeof createMitmProxy;
  /** 测试注入：默认 node:crypto randomUUID。 */
  uuid?: () => string;
}

export class ProxyRuntime {
  private phase: ProxyPhase = 'idle';
  private port: number | null = null;
  private startedAt: string | null = null;
  private proxy: ProxyServerLike | null = null;
  /** design D2：一次成功 proxy run 的不透明 UUID；stop/启动失败即清理。 */
  private captureGroupId: string | null = null;
  private readonly db: Database;
  private readonly emit: (payload: BusEvents['proxy_status']) => void;
  private readonly createProxy: typeof createMitmProxy;
  private readonly uuid: () => string;

  constructor(db: Database, emit: (payload: BusEvents['proxy_status']) => void, deps: ProxyRuntimeDeps = {}) {
    this.db = db;
    this.emit = emit;
    this.createProxy = deps.createProxy ?? createMitmProxy;
    this.uuid = deps.uuid ?? randomUUID;
  }

  /**
   * 当前活跃 captureGroupId（非 API 契约字段；供测试/诊断断言生命周期）。
   * 仅在成功进入 running 期间非空；stop 或启动失败后为 null。
   */
  get currentCaptureGroupId(): string | null {
    return this.captureGroupId;
  }

  status(): ProxyStatus {
    const count = cachedStmt(this.db, COUNT_PROXY_REQUESTS_SQL).get() as { c: number };
    return {
      running: this.phase === 'running',
      starting: this.phase === 'starting',
      port: this.port,
      requestCount: count.c,
      startedAt: this.startedAt,
    };
  }

  /** D4：异步启动。handler 立即返回 starting 态；就绪/失败由 SSE 通知。 */
  start(opts: { port?: number }): ProxyStatus {
    if (this.phase !== 'idle') {
      throw new ProxyStateError('PROXY_ALREADY_RUNNING', '代理已在运行或正在启动');
    }
    this.phase = 'starting';
    this.port = opts.port ?? null;
    this.startedAt = null;
    // design D2：每次启动尝试生成一个新 UUID；仅成功运行期间活跃。
    this.captureGroupId = this.uuid();
    void this.boot(opts.port);
    return this.status();
  }

  stop(): ProxyStatus {
    if (this.phase === 'idle') {
      throw new ProxyStateError('PROXY_NOT_RUNNING', '代理未运行');
    }
    this.phase = 'idle';
    this.port = null;
    this.startedAt = null;
    this.captureGroupId = null;
    const proxy = this.proxy;
    this.proxy = null;
    if (proxy !== null) {
      try {
        proxy.close();
      } catch (err) {
        // 关闭失败不吞错误：记录后继续，状态已置 idle（G11.5 精神：不静默）
        console.error(`mitm proxy close failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.emit({ running: false, starting: false, port: null, error: null });
    return this.status();
  }

  private async boot(port?: number): Promise<void> {
    const captureGroupId = this.captureGroupId;
    try {
      const proxy = await this.createProxy({ db: this.db, port, captureGroupId: captureGroupId ?? undefined });
      if (this.phase !== 'starting') {
        // stop() 在启动完成前被调用：直接关闭新实例
        try {
          proxy.close();
        } catch (err) {
          console.error(`mitm proxy close failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      this.proxy = proxy;
      this.phase = 'running';
      this.startedAt = new Date().toISOString();
      this.port = port ?? this.port;
      this.emit({ running: true, starting: false, port: this.port, error: null });
    } catch (err) {
      this.phase = 'idle';
      this.port = null;
      this.startedAt = null;
      this.captureGroupId = null;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`mitm proxy start failed: ${message}`);
      this.emit({ running: false, starting: false, port: null, error: message });
    }
  }
}

export class FridaRuntime {
  private running = false;
  private starting = false;
  private pid: number | null = null;
  private child: ReturnType<typeof runFridaMonitor>['child'] | null = null;
  private readonly emit: (payload: BusEvents['frida_status']) => void;

  constructor(emit: (payload: BusEvents['frida_status']) => void) {
    this.emit = emit;
  }

  status(): FridaStatus {
    return { running: this.running, starting: this.starting, pid: this.pid };
  }

  /**
   * 异步启动：pid 缺省时同步 await 自动发现（失败 409 FRIDA_TARGET_NOT_FOUND，
   * 契约 §5 要求失败可见）；发现成功后 spawn monitor，就绪由 frida_status 通知。
   * P-3：macOS 无法端到端验证，仅接线纯逻辑。
   */
  async start(opts: { pid?: number }): Promise<FridaStatus> {
    if (this.running || this.starting) {
      return this.status();
    }
    let target = opts.pid;
    if (target === undefined) {
      try {
        target = await discoverFridaTarget();
      } catch (err) {
        throw new FridaTargetError(err instanceof Error ? err.message : String(err));
      }
    }
    this.starting = true;
    this.pid = target;
    this.emit({ running: false, pid: target });
    const scriptPath = join(process.cwd(), 'scripts', 'frida-chat-monitor-v2.js');
    try {
      const { child } = runFridaMonitor(target, scriptPath, (_capture: FridaCaptureData) => {
        // 捕获持久化由后续 proxy-writer 接线（P-3 裁剪）；此处保持状态活跃
        this.emit({ running: true, pid: target });
      });
      this.child = child;
      child.once('spawn', () => {
        this.starting = false;
        this.running = true;
        this.emit({ running: true, pid: target });
      });
      const fail = (): void => {
        this.starting = false;
        this.running = false;
        this.pid = null;
        this.child = null;
        this.emit({ running: false, pid: undefined });
      };
      child.once('error', fail);
      child.once('exit', fail);
    } catch (err) {
      this.starting = false;
      this.pid = null;
      throw new FridaTargetError(err instanceof Error ? err.message : String(err));
    }
    return this.status();
  }

  stop(): FridaStatus {
    const child = this.child;
    this.child = null;
    this.running = false;
    this.starting = false;
    this.pid = null;
    if (child !== null) {
      try {
        child.kill();
      } catch (err) {
        console.error(`frida stop failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.emit({ running: false, pid: undefined });
    return this.status();
  }
}
