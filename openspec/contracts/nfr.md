# Contract: 非功能需求（性能预算）

> **被复刻项目最大的规格缺陷：整份 spec 没有一条性能需求。** 结果是它的首屏要 5.9–12.4 秒。
> 本文件把性能定义为**可验证的硬需求**，与功能需求同等级别。违反预算等同于功能缺陷。
> 「参考实现」一列的数字来自那份实测诊断报告（524 会话 / 73,588 event / 源文件 800MB）——
> 那是**不做这些约束会长成的样子**，不是本项目的起点。本项目从第一行代码就按预算列写。

## 1. 规模假设

系统按 **B 档** 设计。超出上界时必须按 §7 的跳级规则升级架构。

| 维度 | 参考实现实测规模 | 设计上界 | 超限后的动作 |
|------|----------------|---------|-------------|
| 会话数 | 524 | 5,000 | 列表虚拟滚动 + 服务端搜索 |
| event 总数 | 73,588 | 500,000 | events 按时间分表 |
| 单会话 event 数 | p50=36 / p95=401 / max=9,590 | 20,000 | Gantt 时间轴降采样(LOD) |
| 源文件总量 | 800.21MB（1,514 文件） | 5GB | 扫描移入 worker pool |
| 单 provider 最大 | codeagent 739.21MB / 948 文件 | 2GB | 强制 byte-offset 增量读 |
| DB 体积 | 目标 < 200MB | 2GB | 拆库 index/detail/proxy |
| proxy_requests | 1,820 | 100,000 | 保留策略 + FTS5 |

---

## 2. 响应预算（硬需求）

| 场景 | 参考实现实测（反面基线） | **本项目预算** | 验证方式 |
|------|--------|-----------|---------|
| 首屏（启动后 10s 内） | 5,884ms | **< 100ms** | A/B 脚本 Step 4 |
| 首屏（启动后 180s） | 12,399ms | **< 100ms** | 同上 |
| 会话列表 500 条 | 5.33ms / 447.8KB | **< 5ms / < 60KB（gzip）** | 契约测试 |
| 详情：中位会话（36 events） | 1.57ms / 193.3KB | **< 5ms / < 15KB** | 契约测试 |
| 详情：P95 会话（401 events） | 12.94ms / 1,621.6KB | **< 8ms / < 80KB** | 契约测试 |
| 详情：最差会话（9,590 events） | 625.29ms / 32,332.3KB | **< 60ms / < 1,500KB** | 契约测试 |
| 单 event 下钻 | 不存在 | **< 20ms** | 契约测试 |
| Agent Overview | 4,732ms / 524 请求 / 299.6MB | **< 400ms / 1 请求 / < 80KB** | Playwright |
| events 排序查询（最差） | 210.48ms | **< 15ms** | EXPLAIN 断言 |
| 30s 窗口总请求数 | 508 / 151.2MB | **< 15 / < 2MB** | Playwright |
| 无变更增量扫描 | 18,235 SQL / 重读 800MB | **0 SQL / 读 < 20MB** | 写入统计测试 |
| 单会话增量写入（append 1 event） | 348 SQL / 181.91ms | **1 SQL / < 20ms** | 写入统计测试 |
| 事件循环延迟 p99（服务期间） | 未测（spawnSync 阻塞 6,074ms） | **< 50ms** | `monitorEventLoopDelay` |
| DB + WAL 稳态体积 | 471.64MB | **< 200MB，WAL < 20MB** | health 端点 |

---

## 3. 启动行为（硬需求）

| 要求 | 说明 |
|------|------|
| **默认不做全量详情预热** | `prewarmRecent` 默认 `0`。实测按需读取中位 1.57ms、P95 12.94ms，预热收益远小于其造成的 200–1240 倍劣化 |
| 索引阶段必须同步完成 | 仅目录遍历 + 轻量元数据，不读详情、不解密、不 spawn 子进程 |
| 索引阶段耗时 | < 3s @ 1,514 文件 |
| 可选预热必须让路 | 检测到 750ms 内有前台请求则暂停，每个会话之间 `await setTimeout(0)` 让出整轮事件循环 |
| 服务端 listen 不得被预热阻塞 | 预热用 `void backgroundPrewarm(...)`，不 `await` |
| 禁止在请求路径上 spawn 子进程 | Trae 解密只在 30s 轮询中进行，请求路径遇到未就绪返回 `pending: true` |

---

## 4. 禁止事项（会直接违反预算）

1. **禁止 `SELECT *`** —— 一律显式列出返回列
2. **禁止在详情列表接口返回 `raw` / `inputSummary` / `outputSummary`** —— 这三列合计占 DB 的 96%
3. **禁止在循环内 `db.prepare()`** —— 复用 prepared statement
4. **禁止 `spawnSync` / `readFileSync` 出现在 HTTP 请求处理路径上**
5. **禁止逐 session 发射 SSE 事件** —— 必须 200ms 窗口合并
6. **禁止前端为聚合视图逐会话拉详情** —— 必须走服务端聚合端点
7. **禁止全删全插式 `upsertEvents`** —— 必须差分 upsert
8. **禁止跳过 `scan_state` 写入** —— 写入失败必须抛错，不得静默 catch
9. **禁止用正则 split 整个文件字符串解析 JSONL** —— 必须流式逐行（v4 中 `RegExp: \r?\n` self time 459.8ms）
10. **禁止 `ORDER BY LENGTH(col)`** —— 用冗余长度列 + 索引

---

## 5. CI 断言

以下测试必须存在并在 CI 中执行。它们分别锁住最容易被后续迭代无意破坏的点。

```ts
// server/storage/perf.test.ts

it('热查询不产生临时排序', () => {
  const plans = [
    "SELECT id FROM events WHERE session_id = ? ORDER BY sequence",
    "SELECT id FROM sessions WHERE data_source = ? ORDER BY started_at DESC LIMIT 50",
  ];
  for (const sql of plans) {
    const plan = JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x'));
    expect(plan, sql).not.toContain('TEMP B-TREE');
  }
});

it('slim 详情响应在体积预算内', () => {
  const rec = getSessionDetail(db, worstCaseKey, { mode: 'slim' });
  expect(Buffer.byteLength(JSON.stringify(rec))).toBeLessThan(1_500_000);
});

it('无变更重扫零写入零解析', () => {
  scanAndStoreDetail(db, key);
  const before = writeCounter.value;
  const r = scanAndStoreDetail(db, key);
  expect(r?.skipped).toBe(true);
  expect(writeCounter.value).toBe(before);
});

it('append 1 event 只产生 1 条 INSERT', () => {
  appendEventToFixture(key);
  const before = writeCounter.value;
  scanAndStoreDetail(db, key);
  expect(writeCounter.value - before).toBe(1);
});

it('SSE 一轮扫描事件数受控', async () => {
  const seen: unknown[] = [];
  eventBus.on('sessions_changed', e => seen.push(e));
  await scanAndStore({ db });
  await sleep(300);                       // 等合并窗口 flush
  expect(seen.length).toBeLessThanOrEqual(10);
});

it('scan_state 在首轮扫描后非空', async () => {
  await scanAndStore({ db });
  const n = db.prepare('SELECT COUNT(*) c FROM scan_state').get().c;
  expect(n).toBeGreaterThan(0);           // v4 实测为 0，这是回归防线
});
```

```ts
// server/server.perf.test.ts —— 端到端预算
it('启动后 10s 首屏在预算内', async () => {
  const server = await bootServer({ prewarmRecent: 0 });
  await sleep(10_000);
  const t = await timeRequest('/api/sessions?limit=50');
  expect(t).toBeLessThan(100);
});

it('事件循环延迟受控', async () => {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  await hammerRequests(200);
  h.disable();
  expect(h.percentile(99) / 1e6).toBeLessThan(50);   // ns → ms
});
```

---

## 6. 回归基线维护

从 M3（storage 可跑通）起，每个里程碑合入后跑一次 `perf-diag/` 的 Step 2（分段耗时）与 Step 4（A/B），
把数字追加到仓库根的 `PERF-BASELINE.md`：

```
| 日期 | 里程碑 | 首屏@10s | 最差详情 | Overview | 30s请求数 | DB+WAL |
|------|--------|---------|---------|----------|----------|--------|
| —    | 参考实现（反面基线） | 5,884ms | 625ms/32.3MB | 4,732ms/524req | 508 | 471.6MB |
| ...  | M3 storage | | | | | |
```

任何一列相对上一行劣化超过 20% 的提交不得合入，除非在提交说明中写清取舍并同步更新本文件的预算表。

---

## 7. 跳级信号

出现以下任意一条，立刻按更高档位重新设计对应模块，不要等到全面超限：

| 信号 | 触发的升级 |
|------|-----------|
| 单会话 event 数 > 20,000 | Gantt 时间轴 LOD 降采样 + 详情强制分页 |
| 单个源文件 > 200MB | byte-offset 增量读从 P2 提升为强制项 |
| 长期开启 MITM 采集 | `proxy_requests` 独立库 + FTS5 + 强制保留策略 |
| 会话数 > 5,000 | 服务端搜索（FTS5）取代前端 filter |
| 多人共用一个实例 | SQLite 单写锁成为瓶颈，需要写入串行化队列或改用外部 DB |
| 扫描一轮 > 10s | 扫描移入 `worker_threads` pool |
