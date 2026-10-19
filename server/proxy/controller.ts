import { randomUUID } from 'node:crypto';
import { runtimeResourcePath } from '../runtime-paths.js';

import type { Database } from 'better-sqlite3';

import type { BusEvents, ProxyCaptureActivity, ProxyRuntimeStatus } from '../../src/core/trace-types.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { eventBus } from '../realtime/event-bus.js';
import { getProxyRequestListItemById } from '../storage/query-engine.js';
import {
  discoverFridaTarget,
  runFridaMonitor,
  type FridaCaptureData,
} from './frida-capture.js';
import { createMitmProxy, type MitmProxyOptions, type ProxyServerLike } from './mitm-proxy.js';
import type { CaptureBodyStore } from './body-store.js';
import { ConnectionProfileError } from './connection-profiles.js';
import { captureResources } from './capture-resources.js';
import { sseResourceStatus } from '../realtime/sse.js';

/**
 * T-12（contracts/api.md §4/§5）：Proxy / Frida 控制路由的运行时。
 * design.md D4：启动是重活，MUST NOT 阻塞 HTTP handler——start 立即返回
 * `starting` 中间态，就绪/失败由 SSE（proxy_status / frida_status）通知。
 */

export type ProxyPhase = 'idle' | 'starting' | 'running' | 'stopping' | 'failed';
export type ProxyStatus = ProxyRuntimeStatus;

export interface FridaStatus {
  running: boolean;
  starting: boolean;
  pid: number | null;
}

export class ProxyStateError extends Error {
  readonly code: 'PROXY_ALREADY_RUNNING' | 'PROXY_NOT_RUNNING' | 'PROXY_STOP_FAILED' | 'PROXY_MAINTENANCE';

  constructor(code: ProxyStateError['code'], message: string) {
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
  createProxy?: (opts: MitmProxyOptions) => Promise<ProxyServerLike>;
  /** 测试注入：默认 node:crypto randomUUID。 */
  uuid?: () => string;
  notify?: (id: number) => void;
  notifySession?: (key: string, proxyId: number) => void;
  bodyStore?: () => Promise<CaptureBodyStore>;
  caDirectory?: string;
  stopTimeoutMs?: number;
  stopGraceMs?: number;
}

export class ProxyRuntime {
  private phase: ProxyPhase = 'idle';
  private port: number | null = null;
  private startedAt: string | null = null;
  private proxy: ProxyServerLike | null = null;
  /** design D2：一次 proxy run 的不透明 UUID；停止清理完成/启动失败后释放。 */
  private captureGroupId: string | null = null;
  private readonly db: Database;
  private readonly emit: (payload: BusEvents['proxy_status']) => void;
  private readonly createProxy: NonNullable<ProxyRuntimeDeps['createProxy']>;
  private readonly uuid: () => string;
  private readonly notify: (id: number) => void;
  private generation = 0;
  private activityGeneration = 0;
  private readonly bodyStore: (() => Promise<CaptureBodyStore>) | undefined;
  private readonly caDirectory: string | undefined;
  private readonly notifySession: ((key: string, proxyId: number) => void) | undefined;
  private bootTask: Promise<void> | null = null;
  private cleanupTask: Promise<void> | null = null;
  private stopRequest: Promise<ProxyStatus> | null = null;
  private readonly stopTimeoutMs: number;
  private readonly stopGraceMs: number;
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private activity: ProxyCaptureActivity = emptyActivity();
  private runId: string | null = null;
  private maintenance = false;

  constructor(db: Database, emit: (payload: BusEvents['proxy_status']) => void, deps: ProxyRuntimeDeps = {}) {
    this.db = db;
    this.emit = emit;
    this.createProxy = deps.createProxy ?? createMitmProxy;
    this.uuid = deps.uuid ?? randomUUID;
    this.bodyStore = deps.bodyStore;
    this.caDirectory = deps.caDirectory;
    this.notifySession = deps.notifySession;
    this.stopTimeoutMs = deps.stopTimeoutMs ?? 10_000;
    this.stopGraceMs = deps.stopGraceMs ?? 5000;
    this.notify = deps.notify ?? ((id) => {
      const item = getProxyRequestListItemById(this.db, id);
      if (item !== null) {
        const row = cachedStmt(this.db, COUNT_PROXY_REQUESTS_SQL).get() as { c: number };
        eventBus.emit('proxy_request', { id, hostname: item.hostname, item, requestCount: row.c });
      }
    });
  }

  /**
   * 当前活跃 captureGroupId（非 API 契约字段；供测试/诊断断言生命周期）。
   * 仅在成功进入 running 期间非空；stop 或启动失败后为 null。
   */
  get currentCaptureGroupId(): string | null {
    return this.phase === 'running' ? this.captureGroupId : null;
  }

  status(): ProxyStatus {
    const count = cachedStmt(this.db, COUNT_PROXY_REQUESTS_SQL).get() as { c: number };
    const activity = { ...(this.proxy?.captureActivity?.() ?? this.activity) };
    if (this.phase === 'failed' && this.activity.lastError !== null) activity.lastError = this.activity.lastError;
    const phase = this.phase === 'running'
      ? activity.captureErrors > 0 ? 'degraded' : activity.observedRequests > 0 ? 'capturing' : 'waiting_for_traffic'
      : this.phase;
    return {
      running: this.phase === 'running',
      starting: this.phase === 'starting',
      port: this.port,
      requestCount: count.c,
      startedAt: this.startedAt,
      diagnostics: { ...activity, phase, runId: this.runId, cleanupPending: this.phase === 'stopping' || this.cleanupTask !== null || (this.phase === 'failed' && this.proxy !== null), resources: { ...captureResources.snapshot(), ...sseResourceStatus() } },
    };
  }

  /** A bounded readiness wait for the explicit process launcher; no SQL polling. */
  async waitUntilReady(timeoutMs = 10_000): Promise<ProxyStatus> {
    const generation = this.generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.bootTask, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ConnectionProfileError('MONITOR_NOT_READY', 'Proxy startup is not ready; inspect status before starting an Agent', 503)), timeoutMs);
        timer.unref();
      })]);
      if (this.phase !== 'running' || this.generation !== generation) throw new ConnectionProfileError('MONITOR_NOT_READY', `Proxy is not ready (${this.activity.lastError ?? this.phase}); no Agent was started`, 503);
      return this.status();
    } finally { clearTimeout(timer); }
  }

  /** D4：异步启动。handler 立即返回 starting 态；就绪/失败由 SSE 通知。 */
  start(opts: { port?: number }): ProxyStatus {
    if (this.maintenance) throw new ProxyStateError('PROXY_MAINTENANCE', 'Confirmed body cleanup is in progress; wait before starting the monitor');
    if (this.phase !== 'idle' && !(this.phase === 'failed' && this.proxy === null && this.cleanupTask === null)) {
      throw new ProxyStateError('PROXY_ALREADY_RUNNING', '代理已在运行或正在启动');
    }
    this.phase = 'starting';
    this.port = opts.port ?? 7779;
    this.startedAt = null;
    // design D2：每次启动尝试生成一个新 UUID；仅成功运行期间活跃。
    this.captureGroupId = this.uuid();
    this.runId = this.captureGroupId;
    this.activity = emptyActivity();
    this.generation += 1;
    this.activityGeneration = this.generation;
    this.bootTask = this.boot(this.port, this.generation);
    return this.status();
  }

  /** Reserve synchronously before any async work; all start/launch paths share it. */
  async withStoppedMonitor<T>(action: () => Promise<T>): Promise<T> {
    if (this.maintenance || this.cleanupTask !== null || this.stopRequest !== null ||
      !(this.phase === 'idle' || (this.phase === 'failed' && this.proxy === null))) {
      throw new ProxyStateError('PROXY_MAINTENANCE', 'Stop the monitor and wait for owned cleanup before deleting bodies');
    }
    this.maintenance = true;
    try { return await action(); } finally { this.maintenance = false; }
  }

  stop(): Promise<ProxyStatus> {
    if (this.stopRequest !== null) return this.stopRequest;
    if (this.phase === 'idle') {
      return Promise.reject(new ProxyStateError('PROXY_NOT_RUNNING', '代理未运行'));
    }
    this.generation += 1;
    this.phase = 'stopping';
    this.publishStatus();
    if (this.cleanupTask === null) {
      this.cleanupTask = (async () => {
        await this.bootTask;
        const proxy = this.proxy;
        if (proxy?.shutdown !== undefined) await proxy.shutdown({ graceMs: this.stopGraceMs });
        else proxy?.close();
        this.activity = proxy?.captureActivity?.() ?? { ...this.activity, listening: false };
        this.proxy = null;
        this.phase = 'idle';
        this.port = null;
        this.startedAt = null;
        this.captureGroupId = null;
      })().finally(() => { this.cleanupTask = null; this.publishStatus(); });
    }
    const cleanup = this.cleanupTask;
    this.stopRequest = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([cleanup, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('PROXY_STOP_FAILED')), this.stopTimeoutMs);
          timer.unref();
        })]);
        return this.status();
      } catch {
        this.phase = 'failed';
        this.activity.lastError = 'PROXY_STOP_FAILED';
        this.publishStatus();
        throw new ProxyStateError('PROXY_STOP_FAILED', 'Proxy cleanup has not completed; retry stop before restarting');
      } finally {
        clearTimeout(timer);
        this.stopRequest = null;
      }
    })();
    return this.stopRequest;
  }

  private publishStatus(): void {
    if (this.activityTimer !== null) clearTimeout(this.activityTimer);
    this.activityTimer = null;
    const diagnostics = this.status().diagnostics;
    this.emit({ running: this.phase === 'running', starting: this.phase === 'starting', port: this.port, error: this.activity.lastError, diagnostics });
  }

  private async boot(port: number | undefined, generation: number): Promise<void> {
    const captureGroupId = this.captureGroupId;
    try {
      const bodyStore = await this.bodyStore?.();
      if (generation !== this.generation) return;
      const proxy = await this.createProxy({ db: this.db, port, captureGroupId: captureGroupId ?? undefined, notify: this.notify, notifySession: this.notifySession, bodyStore, caDirectory: this.caDirectory, onActivity: activity => {
        if (this.activityGeneration !== generation || this.phase === 'idle') return;
        this.activity = activity;
        if (this.activityTimer === null) {
          this.activityTimer = setTimeout(() => this.publishStatus(), 200);
          this.activityTimer.unref();
        }
      } });
      this.proxy = proxy;
      if (this.phase !== 'starting' || generation !== this.generation) {
        // stop owns this late transport and waits for it; no replacement run
        // can start until the drain has actually completed.
        return;
      }
      this.proxy = proxy;
      this.phase = 'running';
      this.startedAt = new Date().toISOString();
      this.port = port ?? this.port;
      this.activity.listening = true;
      this.publishStatus();
    } catch (err) {
      if (generation !== this.generation) return;
      this.phase = 'failed';
      this.port = null;
      this.startedAt = null;
      this.captureGroupId = null;
      const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code).slice(0, 128) : 'PROXY_START_FAILED';
      this.activity.lastError = code;
      console.error(`mitm proxy start failed: ${code}`);
      this.publishStatus();
    }
  }
}

function emptyActivity(): ProxyCaptureActivity {
  return { listening: false, observedRequests: 0, activeRequests: 0, pendingWrites: 0, persistedRequests: 0, interruptedRequests: 0, captureErrors: 0, lastRequestAt: null, lastError: null };
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
    const scriptPath = runtimeResourcePath('scripts/frida-chat-monitor-v2.js');
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
