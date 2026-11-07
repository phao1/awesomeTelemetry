# Hard bank v2 — M13

**难度实测**：`gpt-6.1-sol` 低思考强度盲测，JavaScript 和 Python 的 8 题全部通过，每题约 1 分钟。Go 的 4 题没有盲测。下文写的“预期强模型会漏在哪”都没有被证实。

本库是待盲测候选，不宣称已达到强模型低思考单次通过率 ≤ 1/2。
题目难度必须以外部盲测的全有或全无结果判断，变异杀伤率不能替代模型难度。
Go 尚未编译、执行或测量变异；manifest 中的 0 是未测占位，不是测得 0%。
Go 资格验证完成前，不应将本库当成已通过运行时资格检查的题库。

## 划分与库存

12 题；javascript/python/go 各 4 题；全部 hard。A/B/C/D 各 3 题且每类覆盖三种语言。
train 6（每语言 2），smoke 3（train 子集，每语言 1），sealed/final 各 3（每语言 1）。
固定 seed 为 `rsi-hard-2026-11-08-v2-split-2`。排序使用 validate.mjs 的 SHA256 排名。
选择规则是不使用任何模型结果，依次尝试 split-0、split-1……，取首个 train 覆盖四类且 sealed/final 各覆盖三类的种子；结果是 split-2。
partition 对输入列表顺序不敏感；hard-bank.test.ts 检查精确划分、语言比例和与默认题库的隔离。
旧版 18 个目录已全部移除，无迁移兼容逻辑。

## 统计口径与资格

文件数和总行数统计 repo/ 的全部文本文件（包含规格、可见测试、数据和 go.mod），不含隐藏测试和 reference.patch。
源码行数另列，排除测试；尤其 B 类可见兼容测试占总行数多数，这个规模数字不构成难度证据。
参考修复行数是 unified diff 的新增/删除行，不计 diff 头和上下文。
隐藏测试数是报告器实际要求的顶层用例数；一个顶层用例可枚举多种调度/分块。
D 类额外枚举：reservoir 81 次 ready-job 选择轨迹，rendezvous 120 个交付/取消/关闭排列，postbox 24 个过期/确认/拒收/重发排列。
C 类使用比较器和/或 cells.read/write 的访问计数，墙钟仅为执行器失控保护。orderbook 每次公开操作都单独设置槽位预算，超标当场断言失败；槽位最多 16 个平面字段，禁止把线性索引藏进单个槽位。strata 还测试非原生整数顺序的比较器，原生数值比较不能绕过计数。
A 类规格 150–400 行，参考修复至少新增 150 行且跨 3 个源文件。
B 类 kiln/folio 各有 4 个分散根因，depot 有 5 个；可见测试在基线和参考实现中通过（Go 待容器确认）。

| 题号 | 语言 | 类 | 题材 | repo 文件 | 总行 | 源码行 | 修复文件 | +行 / -行 | 隐藏数 | 变异比率 | 实跑 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| hard-palimpsest | javascript | A | 快照事务 | 7 | 211 | 53 | 3 | +152 / -15 | 63 | 0.8934 | 是 |
| hard-reservoir | javascript | D | 加权资源预留 | 5 | 51 | 39 | 2 | +74 / -13 | 44 | 0.7879 | 是 |
| hard-orderbook | javascript | C | 有权重的顺序统计 | 4 | 63 | 47 | 1 | +130 / -13 | 41 | 0.8354 | 是 |
| hard-contour | python | C | 稀疏等差坡度账本 | 5 | 77 | 61 | 1 | +25 / -3 | 42 | 0.9206 | 是 |
| hard-rendezvous | python | D | 分代合并加载 | 5 | 99 | 79 | 2 | +84 / -18 | 166 | 0.7818 | 是 |
| hard-fieldscript | python | A | 增量记录语言 | 7 | 203 | 31 | 3 | +160 / -18 | 70 | 0.8683 | 是 |
| hard-waypoint | go | A | 原子指针批编辑 | 7 | 202 | 34 | 3 | +156 / -16 | 61 | 未测 | 否 |
| hard-strata | go | C | 版本区间包络 | 5 | 30 | 18 | 2 | +63 / -7 | 52 | 未测 | 否 |
| hard-postbox | go | D | 带确认的虚拟租约邮箱 | 7 | 57 | 40 | 2 | +99 / -13 | 74 | 未测 | 否 |
| hard-kiln | javascript | B | 增量构建工作区 | 18 | 1890 | 244 | 4 | +14 / -5 | 50 | 1.0000 | 是 |
| hard-depot | python | B | 修订库存流水 | 19 | 1710 | 258 | 7 | +41 / -12 | 56 | 0.7547 | 是 |
| hard-folio | go | B | 归档恢复与导出 | 18 | 1675 | 206 | 4 | +23 / -8 | 52 | 未测 | 否 |

## 每题设计与预期遗漏

### hard-palimpsest

javascript / A / Snapshot transactions with predicate validation

Independent interactions: absent-key reads, delete ABA, blind writes, savepoint rollback of read sets, no-op commits, half-open predicates and closed transactions. Parameterized transaction histories check expected outcomes; broad rules are not repeated in the statement.

预期遗漏：会把冲突判断简化为值相等；漏掉墓碑 ABA、回滚后的读集、空谓词、has 与 null 的区别。

### hard-reservoir

javascript / D / Cancellable weighted resource reservations

Delivery and ownership are separate transitions. Cancellation before queued delivery must return capacity, close must revoke unpublished grants, tickets carry generation identity, FIFO is strict for weighted heads. Permutations include reentrant callbacks and capacity conservation.

预期遗漏：容易把预留等同于已交付，造成取消/关闭泄漏容量；超时零与交付竞争、严格 FIFO 和重复释放彼此独立。

### hard-orderbook

javascript / C / Measured order-statistic index

Initial implementation is correct but linear and repeatedly sorts measured flat slots. Required logarithmic operations include replace-key, duplicate priorities, rank bounds and weighted prefix selection. Comparator sees opaque objects; an independent injected private slot store also charges reads/writes, including prefix sums and movement. Generated differential traces mix mutation and queries.

预期遗漏：常见直接优化会丢失替换时的原始稳定序号，或只缓存大小而忘记旋转/删除后的权重和；只优化比较次数仍会因槽位搬移/汇总访问超标而失败。

### hard-contour

python / C / Sparse arithmetic-ramp accounting

Slow implementation is mathematically correct. Updates are named arithmetic ramps, replacement first removes prior contribution, empty ramps remain names, prefix clipping and negative slopes interact. Measured storage forbids hiding a linear shadow array. Sparse coefficient events require three Fenwick accumulators.

预期遗漏：容易只处理常量区间加法；漏掉坡度起点偏移、右端消除项、负斜率、大整数以及失败批次原子性。

### hard-rendezvous

python / D / Generation-safe coalescing loader

Invalidation with an old in-flight completion, cancel-last versus replacement subscriber, cache hits deferred until delivery, reentrant callbacks, close, duplicate callbacks and TTL equality. Scheduler enumerates explicit delivery/completion choices; no wall clock.

预期遗漏：旧完成覆盖新代、缓存命中的延迟取消、关闭覆盖已排队回调、重复回调对象和 TTL 等号边界容易漏一项。

### hard-fieldscript

python / A / Incremental scoped record language

New subsystem combines UTF-8 chunking, multiline quoted cells, escape continuation, CRLF handling, explicit null versus empty, nested atomic frames and failure latching. Tests split at each byte boundary rather than assuming feed chunks coincide with codepoints or records.

预期遗漏：容易把 CRLF 统一替换而破坏引号内内容，或在半个 UTF-8 字符、尾转义、嵌套提交/外层回滚处丢状态。

### hard-waypoint

go / A / Atomic pointer edit batches

Pointer decoding is strict and ordered, array insertion versus replacement differ, move re-evaluates destination after removal, ancestor moves are forbidden, test compares JSON values, batches preserve input and roll back on any error. Hidden scenarios distinguish every changed statement; Go remains explicitly unexecuted.

预期遗漏：容易先解释 move 目标索引再删除源；二次解码 ~01；混淆缺失和 null；漏掉 merge 的对象/数组/空对象规则。

### hard-strata

go / C / Sweep envelope with deterministic winner provenance

Quadratic baseline is functionally correct. A sweep must expire half-open intervals before entering at the same coordinate, choose sequence then original ordinal, retain provenance, coalesce only identical winners, and keep tombstones. Differential tests use a separate coordinate-cell oracle and measured comparisons.

预期遗漏：容易在同端点入/出事件、同序号优先级、墓碑与值竞争、相同内容但不同来源的合并处出错。

### hard-postbox

go / D / Acknowledged mailbox with virtual leases

Commands run through named buffered channels. Delivery reservations, published leases, cancellation, expiry, stale acknowledgement, duplicate IDs and close interact. Simulator chooses ready channel jobs explicitly. Tests cover both delivery/expiry orders and multiple redelivery generations without sleeps.

预期遗漏：容易让租约从匹配时开始，或允许陈旧 token 确认新交付；关闭、取消、重新排队位置与零租约顺序需分别处理。

### hard-kiln

javascript / B / Incremental content-addressed build workspace

Four independent causes: segment-unsafe and non-longest alias resolution, ambiguous content framing, cache identity omits dependency digests, and stale outputs survive target deletion. Reproduction changes shape after each repair. Source graph, diagnostics, transforms, artifact manifest and incremental state are distinct modules; visible suite exercises healthy project workflows.

预期遗漏：修好别名复现后仍会命中旧依赖缓存；输出看似正确时，删除目标的旧产物和分段摘要碰撞仍独立存在。

### hard-depot

python / B / Revisioned inventory reporting pipeline

Five distributed roots: source-order latest selection instead of revision order, zero corrections treated as absent, date cache invalidation only tracks new day not old day, tuple group keys flattened ambiguously, and default decimal precision rounding conversion/accumulation/rendering/export/subtraction. Reproduction changes both warehouse and event date, so fixing selection exposes stale old-day projections. Visible suites stay green for append-only, positive revisions.

预期遗漏：按到达顺序取最新后，修订乱序会回退；仅刷新新日期会遗留旧日期；零数量和分组对的分隔符碰撞容易被漏掉；默认 Decimal 精度还会在单位转换、相消汇总、展示及差额计算中丢掉微小值。

### hard-folio

go / B / In-memory archive restoration and deterministic export

Four dispersed causes: subtree removal uses raw prefix, symlinks resolve from archive root, hardlinks retain a live target instead of snapshot content, export sorts case-folded paths. The fixture first creates links then edits/removes source paths. No changed statement is left without a distinguishing hidden scenario; container qualification is pending.

预期遗漏：修好相对软链接后，硬链接仍跟随旧目标；删除目录误删同名前缀兄弟；大小写折叠排序会破坏确定导出。

## 指纹与公平性

meta.json 保留真实 questionId、repository 和隐藏 testNames。
filePaths、rareStrings、expectedValues 为空：本批题没有足够可靠的独特路径/常量需要额外登记，不制造 witness 字符串，也不把完整文件清单当指纹。
普通 README.md、main.go、go.mod、index.js、package.json 及常见源文件名不进入字典。
作者校验仅要求已登记的路径存在；完整文件清单由目录遍历校验。
hard-bank.test.ts 同时检查 ID/测试名能命中 L1、普通优化建议与常见文件名不误报、参考补丁不触发 scanTargetPatch。
隐藏用例的行为均来自 repo 文档或现有 API；题面不复制缺陷清单。
参考补丁只改源文件，未改测试或依赖声明。无运行时依赖、网络、真实 sleep 或随机调度。

## 已执行与未运行

已执行：8 题 JS/Python 的可见基线/参考、隐藏基线失败/参考全过、mutate.mjs。
作者用例：hard-bank.test.ts；项目回归：src/catch-guard.test.ts 与 src/styles。
常规 npm run typecheck 因只读 node_modules/.tmp 写缓存 EPERM 失败；使用以下等价编译检查通过：

```sh
npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile /tmp/hard-bank-app.tsbuildinfo
npx tsc -p tsconfig.node.json --noEmit --tsBuildInfoFile /tmp/hard-bank-node.tsbuildinfo
npx eslint scripts/rsi-bank/validate.mjs scripts/rsi-bank/mutate.mjs scripts/rsi-bank/hard-bank.test.ts
npx vitest run --configLoader native --no-cache scripts/rsi-bank/hard-bank.test.ts src/catch-guard.test.ts src/styles
node scripts/rsi-bank/validate.mjs --bank rsi-bank-hard
node scripts/rsi-bank/mutate.mjs --bank rsi-bank-hard
```

未运行：全部 Go 编译/可见/隐藏/变异；Docker；全量应用测试；外部低思考盲测。src/styles/build-budget.test.ts 的构建后 CSS 预算用例因没有构建产物而跳过。没有提交。
容器外先运行 scripts/rsi-bank/validate-in-container.sh --bank rsi-bank-hard，再检查 Go 四题比率均 ≥ 0.7。
该脚本在含三种工具链的容器中本地运行校验与变异，且通过异步 docker CLI；不是在当前沙箱运行过的结果。
同步首个测试在报告器输出 started 前卡住时，mutate 会独立进行语法/构建检查，只有可构建的超时变异才计 killed；语法/构建失败仍不计入杀伤分母。
Go 不可用导致 skip，不能用已通过的 JS/Python 均值掩盖。
Go 隐藏测试放在 checks/ 独立包，通过公开 API 导入 workspace；meta.testTargets 为 ./checks，避免把可见用例混入 expectedTests。可见测试仍独立运行。隐藏测试把非预期 panic 记为当前用例失败并继续报告；预期负租约 panic 另行断言。邮箱 Stats 公开队列/预留与已交付/等待/ID 所有权计数，用于检查关闭后的资源清理。

## 逐题变异证据

<!-- mutation-results:start -->
| Question | Mode | Killed | Survived | Invalid | Ratio | Surviving mutants / status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| hard-palimpsest | local | 109 | 13 | 8 | 0.8934 | store/history.mjs:18#19 replace 1 with 2; store/history.mjs:18#20 replace 1 with 0; store/history.mjs:33#33 delete statement; transaction/frames.mjs:24#17 delete statement; transaction/session.mjs:68#38 delete statement; transaction/session.mjs:72#45 delete statement; transaction/session.mjs:75#46 delete statement; transaction/session.mjs:92#52 delete statement; transaction/session.mjs:93#53 replace 0 with 1; transaction/session.mjs:93#54 delete statement; transaction/session.mjs:100#58 replace 0 with 1; transaction/session.mjs:100#59 delete statement; transaction/session.mjs:101#60 delete statement |
| hard-reservoir | local | 52 | 14 | 11 | 0.7879 | reservations/pump.mjs:7#5 delete statement; reservations/pump.mjs:13#11 replace !== with ===; reservations/pump.mjs:14#12 delete statement; pool.mjs:10#11 delete statement; pool.mjs:20#17 delete statement; pool.mjs:21#18 delete statement; pool.mjs:34#30 replace !== with ===; pool.mjs:35#31 delete statement; pool.mjs:36#32 delete statement; pool.mjs:37#35 delete statement; pool.mjs:45#42 replace || with &&; pool.mjs:46#44 delete statement; pool.mjs:47#45 delete statement; pool.mjs:48#46 delete statement |
| hard-orderbook | local | 132 | 26 | 1 | 0.8354 | ordered.mjs:8#2 replace 0 with 1; ordered.mjs:14#10 replace 0 with 1; ordered.mjs:18#19 replace 1 with 2; ordered.mjs:41#40 replace > with >=; ordered.mjs:41#41 replace 1 with 2; ordered.mjs:41#42 replace 1 with 0; ordered.mjs:43#44 replace < with <=; ordered.mjs:44#45 delete statement; ordered.mjs:49#48 replace < with <=; ordered.mjs:49#50 replace 1 with 2; ordered.mjs:49#51 replace 1 with 0; ordered.mjs:51#53 replace < with <=; ordered.mjs:52#54 delete statement; ordered.mjs:62#61 replace ++ with --; ordered.mjs:63#65 replace 1 with 2; ordered.mjs:63#66 replace 1 with 0; ordered.mjs:68#71 replace < with <=; ordered.mjs:68#72 replace 0 with 1; ordered.mjs:80#84 delete statement; ordered.mjs:121#125 replace || with &&; ordered.mjs:121#128 replace || with &&; ordered.mjs:121#129 replace >= with >; ordered.mjs:129#139 delete statement; ordered.mjs:133#143 delete statement; ordered.mjs:134#145 replace && with ||; ordered.mjs:134#146 replace > with >= |
| hard-contour | local | 58 | 5 | 2 | 0.9206 | ramps.py:12#10 replace 1 with 2; ramps.py:13#15 replace 1 with 2; ramps.py:29#45 replace 1 with 0; ramps.py:30#49 replace 0 with 1; ramps.py:31#52 replace 0 with 1 |
| hard-rendezvous | local | 43 | 12 | 14 | 0.7818 | cache.py:12#5 delete statement; cache.py:14#9 replace 1 with 0; cache.py:16#11 replace > with >=; flights.py:14#3 delete statement; flights.py:41#19 delete statement; flights.py:60#31 delete statement; flights.py:65#35 delete statement; flights.py:70#38 delete statement; flights.py:76#43 delete statement; flights.py:84#48 delete statement; flights.py:90#51 delete statement; flights.py:96#54 delete statement |
| hard-fieldscript | local | 145 | 22 | 9 | 0.8683 | table/lexical.py:20#18 replace and with or; table/lexical.py:20#20 replace and with or; table/lexical.py:34#33 replace == with !=; table/lexical.py:34#34 delete statement; table/lexical.py:60#58 delete statement; table/lexical.py:64#62 delete statement; table/lexical.py:69#66 replace == with !=; table/lexical.py:69#67 delete statement; table/lexical.py:72#69 delete statement; table/lexical.py:74#71 delete statement; table/lexical.py:79#73 delete statement; table/lexical.py:80#74 delete statement; table/scopes.py:7#3 replace or with and; table/scopes.py:7#5 replace or with and; table/scopes.py:7#7 replace and with or; table/scopes.py:7#9 replace == with !=; table/scopes.py:15#16 replace 1 with 0; table/scopes.py:27#37 replace 1 with 0; table/scopes.py:27#38 delete statement; table/scopes.py:30#43 delete statement; table/scopes.py:35#51 delete statement; table/stream.py:15#7 delete statement |
| hard-waypoint | local | 92 | 6 | 18 | 0.9388 | pointer.go:29#24 replace 0 with 1; pointer.go:30#27 replace > with >=; pointer.go:30#28 replace 0 with 1; pointer.go:32#30 replace || with &&; pointer.go:32#39 replace 0 with 1; tree.go:81#48 replace 1 with 0 |
| hard-strata | local | 71 | 12 | 8 | 0.8554 | envelope.go:8#2 replace 2 with 3; envelope.go:8#3 replace 2 with 1; envelope.go:14#8 replace < with <=; envelope.go:14#9 replace 0 with 1; envelope.go:27#20 replace 0 with 1; envelope.go:28#24 replace < with <=; envelope.go:28#25 replace && with ||; envelope.go:28#26 replace > with >=; winners.go:5#4 replace > with >=; winners.go:6#6 replace < with <=; winners.go:11#13 replace > with >=; winners.go:12#20 replace 2 with 1 |
| hard-postbox | local | 67 | 8 | 28 | 0.8933 | dispatch.go:17#16 replace || with &&; mailbox.go:15#15 delete statement; mailbox.go:19#20 replace 1 with 2; mailbox.go:31#37 delete statement; mailbox.go:52#55 delete statement; mailbox.go:61#61 replace 1 with 0; mailbox.go:71#69 replace == with !=; mailbox.go:77#78 delete statement |
| hard-kiln | local | 19 | 0 | 3 | 1.0000 | none |
| hard-depot | local | 40 | 13 | 6 | 0.7547 | inventory/export.py:20#6 replace 0 with 1; inventory/export.py:20#7 replace 0 with 1; inventory/export.py:20#8 replace 0 with 1; inventory/export.py:20#10 replace 0 with 1; inventory/quantities.py:25#4 replace 1 with 2; inventory/quantities.py:25#5 replace 1 with 0; inventory/quantities.py:31#12 replace + with -; inventory/quantities.py:31#14 replace + with -; inventory/quantities.py:31#17 replace 1 with 2; inventory/quantities.py:33#20 replace 1 with 2; inventory/quantities.py:33#21 replace 1 with 0; inventory/quantities.py:38#28 replace - with +; inventory/revisions.py:5#3 replace > with >= |
| hard-folio | local | 10 | 0 | 4 | 1.0000 | none |
<!-- mutation-results:end -->
