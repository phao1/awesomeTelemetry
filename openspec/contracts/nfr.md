# Contract: Non-functional requirements (performance budget)

> **The biggest spec flaw in the recreated project: its spec had zero
> performance requirements.** As a result its first screen took 5.9-12.4
> seconds. This file defines performance as a **verifiable hard requirement**
> at the same level as functional requirements. Exceeding the budget equals a
> functional defect. The "reference implementation" column comes from that
> measured diagnostic report (524 sessions / 73,588 events / 800MB source
> files) — it describes what the project would grow into **without these
> constraints**, not where this project starts. This project is written to the
> budget columns from the first line of code.

## 1. Scale assumptions

The system is designed for **tier B**. When the design ceiling is exceeded,
upgrade the architecture per the §7 escalation rules.

| Dimension | Reference measured scale | Design ceiling | Action when exceeded |
|-----------|--------------------------|----------------|----------------------|
| Sessions | 524 | 5,000 | list virtualization + server-side search |
| Total events | 73,588 | 500,000 | partition events by time |
| Events per session | p50=36 / p95=401 / max=9,590 | 20,000 | Gantt timeline LOD downsampling |
| Total source size | 800.21MB (1,514 files) | 5GB | move scanning into a worker pool |
| Largest provider | codeagent 739.21MB / 948 files | 2GB | force byte-offset incremental reads |
| DB size | target < 200MB | 2GB | split DB into index/detail/proxy |
| proxy_requests | 1,820 | 100,000 | retention policy + FTS5 |

---

## 2. Response budget (hard requirement)

| Scenario | Reference measured (negative baseline) | **This project's budget** | Verification |
|----------|----------------------------------------|---------------------------|--------------|
| First screen (within 10s of startup) | 5,884ms | **< 100ms** | A/B script Step 4 |
| First screen (within 180s) | 12,399ms | **< 100ms** | same |
| Session list, 500 items | 5.33ms / 447.8KB | **< 5ms / < 60KB (gzip)** | contract test |
| Detail: median session (36 events) | 1.57ms / 193.3KB | **< 5ms / < 15KB** | contract test |
| Detail: P95 session (401 events) | 12.94ms / 1,621.6KB | **< 8ms / < 80KB** | contract test |
| Detail: worst session (9,590 events) | 625.29ms / 32,332.3KB | **< 60ms / < 1,500KB** | contract test |
| Single event drill-down | did not exist | **< 20ms** | contract test |
| Agent Overview | 4,732ms / 524 requests / 299.6MB | **< 400ms / 1 request / < 80KB** | Playwright |
| Mission 冷启（add-mission-control） | — | **< 500ms / 1 request / < 120KB (gzip)** | `perf-diag/08-mission.mjs` |
| Mission 缓存命中 | — | **< 20ms** | 同上 |
| Mission 单 widget SQL | — | **< 30ms @ tier B**（逐条 EXPLAIN + 计时断言） | 同上 |
| 事件循环 p99（mission 请求期间） | unmeasured（同步 GROUP BY 会顶穿） | **< 50ms**（沿用 §2；A/B/C 三区之间 `await setTimeout(0)` 让出） | 同上 |
| Event sort query (worst) | 210.48ms | **< 15ms** | EXPLAIN assertion |
| Total requests in a 30s window | 508 / 151.2MB | **< 15 / < 2MB** | Playwright |
| Incremental scan, no changes | 18,235 SQL / reread 800MB | **0 SQL / read < 20MB** | write-counter test |
| Incremental write of one session (append 1 event) | 348 SQL / 181.91ms | **1 SQL / < 20ms** | write-counter test |
| Event-loop delay p99 (during service) | unmeasured (spawnSync blocked 6,074ms) | **< 50ms** | `monitorEventLoopDelay` |
| Steady-state DB + WAL size | 471.64MB | **< 200MB, WAL < 20MB** | health endpoint |

---

## 3. Startup behavior (hard requirement)

| Requirement | Description |
|-------------|-------------|
| **No full detail prewarm by default** | `prewarmRecent` defaults to `0`. Measured on-demand reads: median 1.57ms, P95 12.94ms; prewarm's benefit is nowhere near its 200-1240x degradation |
| Index phase must complete synchronously | directory traversal + lightweight metadata only; no detail reads, no decryption, no child processes |
| Index phase time | < 3s @ 1,514 files |
| Optional prewarm must yield | pause when a foreground request is detected within 750ms; `await setTimeout(0)` between sessions to yield a full event-loop round |
| Server listen must not be blocked by prewarm | prewarm uses `void backgroundPrewarm(...)`, never `await` |
| No child process spawns on the request path | Trae decryption only runs in 30s polling; the request path returns `pending: true` when not ready |

---

## 4. Prohibitions (directly violate the budget)

1. **No `SELECT *`** — always list return columns explicitly
2. **Never return `raw` / `inputSummary` / `outputSummary` from detail list
   endpoints** — these three columns total 96% of DB size
3. **No `db.prepare()` inside loops** — reuse prepared statements
4. **No `spawnSync` / `readFileSync` on HTTP request handling paths**
5. **No per-session SSE events** — must coalesce on a 200ms window
6. **No frontend per-session detail fetches for aggregation views** — must use
   server-side aggregation endpoints
7. **No delete-and-reinsert `upsertEvents`** — must use differential upsert
8. **No skipping `scan_state` writes** — write failures must throw, never
   silently catch
9. **No regex-splitting the whole file to parse JSONL** — must stream line by
   line (v4: `RegExp: \r?\n` self time 459.8ms)
10. **No `ORDER BY LENGTH(col)`** — use a redundant length column + index

---

## 5. CI assertions

The following tests must exist and run in CI. Each locks down a point most
likely to be broken unintentionally by later iterations.

```ts
// server/storage/perf.test.ts

it('hot queries do not produce temp sorts', () => {
  const plans = [
    "SELECT id FROM events WHERE session_id = ? ORDER BY sequence",
    "SELECT id FROM sessions WHERE data_source = ? ORDER BY started_at DESC LIMIT 50",
  ];
  for (const sql of plans) {
    const plan = JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x'));
    expect(plan, sql).not.toContain('TEMP B-TREE');
  }
});

it('slim detail response is within the size budget', () => {
  const rec = getSessionDetail(db, worstCaseKey, { mode: 'slim' });
  expect(Buffer.byteLength(JSON.stringify(rec))).toBeLessThan(1_500_000);
});

it('no-change rescan produces zero writes and zero parsing', () => {
  scanAndStoreDetail(db, key);
  const before = writeCounter.value;
  const r = scanAndStoreDetail(db, key);
  expect(r?.skipped).toBe(true);
  expect(writeCounter.value).toBe(before);
});

it('appending 1 event produces exactly 1 INSERT', () => {
  appendEventToFixture(key);
  const before = writeCounter.value;
  scanAndStoreDetail(db, key);
  expect(writeCounter.value - before).toBe(1);
});

it('SSE events per scan round stay bounded', async () => {
  const seen: unknown[] = [];
  eventBus.on('sessions_changed', e => seen.push(e));
  await scanAndStore({ db });
  await sleep(300);                       // wait for the coalescing window to flush
  expect(seen.length).toBeLessThanOrEqual(10);
});

it('scan_state is non-empty after the first scan', async () => {
  await scanAndStore({ db });
  const n = db.prepare('SELECT COUNT(*) c FROM scan_state').get().c;
  expect(n).toBeGreaterThan(0);           // v4 measured 0; this is the regression guard
});
```

```ts
// server/server.perf.test.ts —— end-to-end budget
it('first screen 10s after startup is within budget', async () => {
  const server = await bootServer({ prewarmRecent: 0 });
  await sleep(10_000);
  const t = await timeRequest('/api/sessions?limit=50');
  expect(t).toBeLessThan(100);
});

it('event loop delay stays controlled', async () => {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  await hammerRequests(200);
  h.disable();
  expect(h.percentile(99) / 1e6).toBeLessThan(50);   // ns → ms
});
```

---

## 6. Regression baseline maintenance

From M3 (storage working), after every milestone merge run Step 2 (segment
timing) and Step 4 (A/B) of `perf-diag/` and append the numbers to
`PERF-BASELINE.md` at the repo root:

```
| Date | Milestone | First screen @10s | Worst detail | Overview | Requests in 30s | DB+WAL |
|------|-----------|-------------------|--------------|----------|-----------------|--------|
| —    | reference (negative baseline) | 5,884ms | 625ms/32.3MB | 4,732ms/524req | 508 | 471.6MB |
| ...  | M3 storage | | | | | |
```

Any column degrading more than 20% vs the previous row blocks the commit
unless the trade-off is documented in the commit message and the budget table
in this file is updated in sync.

---

## 7. Escalation signals

If any of the following appears, immediately redesign the affected module for
the next tier — do not wait until everything is over budget:

| Signal | Triggered upgrade |
|--------|-------------------|
| Events per session > 20,000 | Gantt timeline LOD downsampling + forced detail pagination |
| Single source file > 200MB | byte-offset incremental reads promoted from P2 to mandatory |
| Long-term MITM capture enabled | `proxy_requests` in a separate DB + FTS5 + enforced retention |
| Sessions > 5,000 | server-side search (FTS5) replaces frontend filtering |
| Multiple people share one instance | SQLite single-writer lock becomes the bottleneck; need a write serialization queue or external DB |
| One scan round > 10s | move scanning into a `worker_threads` pool |
