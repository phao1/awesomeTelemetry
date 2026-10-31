import { CDP_LIMITS, connectCdpCapture, discoverCdpTargets } from './cdp-capture.js';
import type { CdpCaptureEntry, CdpCaptureIssue, CdpCaptureOptions, CdpTarget } from './cdp-capture.js';

export interface CdpCaptureSessionOptions extends CdpCaptureOptions {
  devOnly: true;
  port?: number;
  discover?: typeof discoverCdpTargets;
}
export interface CdpSessionStatus {
  state: 'idle' | 'running' | 'stopping';
  discovering: boolean;
  targetCount: number;
  connectedTargetCount: number;
}
interface Slot {
  target: CdpTarget;
  controller: AbortController;
  stop?: () => void;
  setup: Promise<void>;
}

/** Explicitly started dev-only owner. No production route or automatic startup. */
export class CdpCaptureSession {
  private readonly options: CdpCaptureSessionOptions;
  private readonly onCapture: (entry: CdpCaptureEntry, target: CdpTarget) => void;
  private state: CdpSessionStatus['state'] = 'idle';
  private generation = 0;
  private slots = new Map<string, Slot>();
  private setups = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private discovery?: AbortController;
  private refreshTask?: Promise<void>;
  private initialTask?: Promise<void>;
  private stopTask?: Promise<void>;
  private readonly externalAbort = () => { void this.stop(); };

  constructor(options: CdpCaptureSessionOptions, onCapture: (entry: CdpCaptureEntry, target: CdpTarget) => void) {
    if (options.devOnly !== true) throw new Error('CDP capture is dev-only');
    const port = options.port ?? 9222;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CDP port');
    this.options = { ...options, port };
    this.onCapture = onCapture;
  }

  getStatus(): CdpSessionStatus {
    return {
      state: this.state,
      discovering: this.discovery !== undefined,
      targetCount: this.slots.size,
      connectedTargetCount: [...this.slots.values()].filter((slot) => slot.stop !== undefined).length,
    };
  }

  getTargets(): CdpTarget[] {
    return [...this.slots.values()].map(slot => ({ ...slot.target }));
  }

  start(): Promise<void> {
    if (this.state === 'stopping') return Promise.reject(new Error('CDP session is stopping'));
    if (this.state === 'running') return this.initialTask ?? Promise.resolve();
    if (this.options.signal?.aborted) return Promise.reject(new Error('CDP session aborted'));
    this.state = 'running';
    this.generation++;
    this.options.signal?.addEventListener('abort', this.externalAbort, { once: true });
    this.timer = setInterval(() => { void this.refresh(); }, CDP_LIMITS.discoveryIntervalMs);
    this.timer.unref?.();
    this.initialTask = this.refresh();
    return this.initialTask;
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    if (this.state === 'idle') return Promise.resolve();
    this.state = 'stopping';
    this.generation++;
    clearInterval(this.timer);
    this.timer = undefined;
    this.options.signal?.removeEventListener('abort', this.externalAbort);
    this.discovery?.abort();
    for (const slot of this.slots.values()) this.closeSlot(slot);
    this.slots.clear();
    this.stopTask = (async () => {
      await this.refreshTask;
      await Promise.all(this.setups);
      this.state = 'idle';
      this.initialTask = undefined;
      this.stopTask = undefined;
    })();
    return this.stopTask;
  }

  private report(issue: CdpCaptureIssue) {
    try { this.options.onIssue?.(issue); } catch { /* observation must not prevent cleanup */ }
  }
  private closeSlot(slot: Slot) {
    slot.controller.abort();
    slot.stop?.();
  }

  private refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    if (this.state !== 'running') return Promise.resolve();
    const epoch = this.generation;
    const controller = new AbortController();
    this.discovery = controller;
    // Own a deadline even if an injected discovery ignores AbortSignal.
    let abort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('CDP discovery aborted'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    const deadline = setTimeout(() => controller.abort(), CDP_LIMITS.discoveryTimeoutMs);
    deadline.unref?.();
    this.refreshTask = (async () => {
      try {
        const targets = await Promise.race([
          Promise.resolve().then(() => (this.options.discover ?? discoverCdpTargets)(this.options.port, { signal: controller.signal })),
          aborted,
        ]);
        if (this.state !== 'running' || this.generation !== epoch || controller.signal.aborted) return;
        if (!Array.isArray(targets) || targets.length > CDP_LIMITS.maxDiscoveryTargets) throw new Error('CDP target limit');
        const unique = new Map<string, CdpTarget>();
        for (const target of targets) {
          const old = unique.get(target.id);
          if (old && old.webSocketDebuggerUrl !== target.webSocketDebuggerUrl) throw new Error('Ambiguous CDP target');
          unique.set(target.id, { ...target });
        }
        if (unique.size > CDP_LIMITS.maxTargets) this.report({ code: 'target_limit', requestId: null, commandId: null });
        const selected = new Map([...unique].slice(0, CDP_LIMITS.maxTargets));
        for (const [id, slot] of this.slots) {
          if (selected.get(id)?.webSocketDebuggerUrl !== slot.target.webSocketDebuggerUrl) {
            this.closeSlot(slot);
            this.slots.delete(id);
          }
        }
        for (const [id, target] of selected) {
          if (this.state !== 'running' || this.generation !== epoch) break;
          if (!this.slots.has(id)) this.addTarget(target, epoch);
        }
      } catch {
        if (this.state === 'running' && this.generation === epoch) {
          this.report({ code: 'discovery_error', requestId: null, commandId: null });
        }
      } finally {
        clearTimeout(deadline);
        controller.signal.removeEventListener('abort', abort);
        if (this.discovery === controller) this.discovery = undefined;
        this.refreshTask = undefined;
      }
    })();
    return this.refreshTask;
  }

  private addTarget(target: CdpTarget, epoch: number) {
    const slot: Slot = { target, controller: new AbortController(), setup: Promise.resolve() };
    this.slots.set(target.id, slot);
    const current = () => this.state === 'running' && this.generation === epoch && this.slots.get(target.id) === slot;
    slot.setup = connectCdpCapture(target, (entry) => {
      if (current()) this.onCapture(entry, { ...target });
    }, {
      signal: slot.controller.signal,
      webSocketFactory: this.options.webSocketFactory,
      onIssue: (issue) => { if (current()) this.report(issue); },
      onDisconnect: () => {
        if (!current()) return;
        this.slots.delete(target.id);
        try { this.options.onDisconnect?.(); } catch {
          this.report({ code: 'callback_error', requestId: null, commandId: null });
        }
      },
    }).then((stop) => {
      if (current()) slot.stop = stop;
      else stop();
    }).catch(() => {
      // Factory/URL errors can reject before the transport installs diagnostics.
      if (current()) {
        this.slots.delete(target.id);
        this.report({ code: 'connection_error', requestId: null, commandId: null });
      }
    }).finally(() => { this.setups.delete(slot.setup); });
    this.setups.add(slot.setup);
  }
}
