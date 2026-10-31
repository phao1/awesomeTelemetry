import type { TaskHydrationFrame, TaskHydrationProgress, TaskHydrationReason } from '../../src/core/task-types.js';

export interface HomeHydrationMember { taskId: string; key: string; loaded: boolean }
type Outcome = 'loaded' | TaskHydrationReason;
interface Lease {
  states: Map<string, TaskHydrationProgress>;
  jobs: Set<Job>;
  update: (frame: TaskHydrationFrame) => void;
  dirty: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  released: boolean;
}
interface Job { key: string; owners: Map<Lease, Set<string>>; controller: AbortController; active: boolean }
export class HomeHydrationBusy extends Error { constructor() { super('Task hydration capacity reached'); } }

/** A page owns its queue; admitted parser work is retained until it actually finishes. */
export class TaskHomeHydrator {
  private readonly jobs = new Map<string, Job>();
  private readonly leases = new Set<Lease>();
  private readonly running = new Set<Promise<void>>();
  private scheduled = false;
  private closed = false;
  constructor(privateDeps: {
    load: (key: string, signal: AbortSignal) => Promise<Outcome>;
    notify: (key: string) => void;
    onError: (error: unknown) => void;
  }) { this.deps = privateDeps; }
  private readonly deps;

  subscribe(taskIds: string[], members: HomeHydrationMember[], update: Lease['update']): () => void {
    const wanted = new Set(members.filter(m => !m.loaded).map(m => m.key));
    const newJobs = [...wanted].filter(key => !this.jobs.has(key)).length;
    if (this.closed || this.leases.size >= 4 || this.jobs.size + newJobs > 5000) throw new HomeHydrationBusy();
    const lease: Lease = { states: new Map(taskIds.map(taskId => [taskId, { taskId, pending: 0, loaded: 0, reasons: [] }])), jobs: new Set(), update, dirty: new Set(), released: false };
    this.leases.add(lease);
    const seen = new Set<string>();
    for (const member of members) {
      const state = lease.states.get(member.taskId);
      if (!state || seen.has(member.taskId + '\0' + member.key)) continue;
      seen.add(member.taskId + '\0' + member.key);
      if (member.loaded) { state.loaded++; continue; }
      state.pending++;
      let job = this.jobs.get(member.key);
      if (!job || job.controller.signal.aborted) {
        job = { key: member.key, owners: new Map(), controller: new AbortController(), active: false };
        this.jobs.set(member.key, job);
      }
      const tasks = job.owners.get(lease) ?? new Set<string>(); tasks.add(member.taskId); job.owners.set(lease, tasks); lease.jobs.add(job);
    }
    for (const state of lease.states.values()) if (!state.loaded && !state.pending) state.reasons.push('member_unavailable');
    const done = [...lease.states.values()].every(s => !s.pending);
    this.emit(lease,{ items: structuredClone([...lease.states.values()]), done });
    if (done || lease.released) this.release(lease);
    else {
      lease.deadline = setTimeout(() => this.cancel(lease), 120000); lease.deadline.unref();
      this.schedule();
    }
    return () => this.release(lease);
  }
  private emit(lease:Lease,frame:TaskHydrationFrame):void {
    try{lease.update(frame);}catch(error){this.release(lease);this.deps.onError(error);}
  }
  private release(lease: Lease): void {
    if (lease.released) return;
    lease.released = true;
    clearTimeout(lease.timer); clearTimeout(lease.deadline);
    this.leases.delete(lease);
    for (const job of lease.jobs) {
      job.owners.delete(lease);
      if (!job.owners.size) {
        job.controller.abort();
        if (!job.active && this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      }
    }
    lease.jobs.clear();
  }
  private cancel(lease: Lease): void {
    if (lease.released) return;
    const items = [...lease.states.values()].map(s => ({ ...s, pending: 0, reasons: [...new Set<TaskHydrationReason>([...s.reasons, 'cancelled'])] }));
    this.emit(lease,{ items, done: true }); this.release(lease);
  }
  private flush(lease: Lease): void {
    if (lease.released) return;
    clearTimeout(lease.timer); lease.timer = undefined;
    const done = [...lease.states.values()].every(s => !s.pending);
    const items = [...lease.dirty].map(id => structuredClone(lease.states.get(id)!)); lease.dirty.clear();
    if (items.length || done) this.emit(lease,{ items, done });
    if (done) this.release(lease);
  }
  private settle(job: Job, outcome: Outcome): void {
    for (const [lease, tasks] of job.owners) {
      if (lease.released) continue;
      for (const taskId of tasks) {
        const state = lease.states.get(taskId)!; state.pending--;
        if (outcome === 'loaded') state.loaded++;
        else if (!state.reasons.includes(outcome)) state.reasons.push(outcome);
        // Initial and terminal states only: never one frame per member.
        if (!state.pending) lease.dirty.add(taskId);
      }
      lease.jobs.delete(job);
      if ([...lease.states.values()].every(s => !s.pending)) this.flush(lease);
      else if (lease.dirty.size && !lease.timer) { lease.timer = setTimeout(() => this.flush(lease), 200); lease.timer.unref(); }
    }
    if (outcome !== 'cancelled') {try{this.deps.notify(job.key);}catch(error){this.deps.onError(error);}}
  }
  private schedule(): void {
    if (this.scheduled || this.closed) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (this.closed) return;
      for (const job of this.jobs.values()) {
        if (this.running.size >= 2) break;
        if (job.active || !job.owners.size || job.controller.signal.aborted) continue;
        job.active = true;
        // Promise callback runs after admission, outside the HTTP handler's turn.
        const work = Promise.resolve().then(() => this.deps.load(job.key, job.controller.signal))
          .then(outcome => this.settle(job, outcome), error => { this.deps.onError(error); this.settle(job, 'parse_failed'); })
          .finally(() => { this.running.delete(work); if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); this.schedule(); });
        this.running.add(work);
      }
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const lease of [...this.leases]) this.cancel(lease);
    await Promise.allSettled([...this.running]);
  }
}
