// add-mission-control §4.7：GET /api/mission 性能守门（design.md §7.3 / nfr §2）。
// 预算：冷启 < 500ms；缓存命中 < 20ms；单 widget SQL < 30ms @ tier B；
// 事件循环在 A/B/C 三区之间让出（此脚本只计时 SQL，让出逻辑在 mission.ts）。
// ⚠️ SQL 镜像 server/storage/mission.ts —— 改口径必须两边同步。
import { createSyntheticDb } from './lib/synthetic-db.mjs';

const fixture = createSyntheticDb();
try {
  const { db } = fixture;
  const TZ = 480;

  const stampSql =
    'SELECT MAX(updated_at) AS stamp FROM sessions WHERE data_source = ? AND started_at >= ?';
  const stampParams = ['scan', new Date(Date.now() - 7 * 86_400_000).toISOString()];

  // 代表性 P1 widget SQL（B3 落地；其余 widget 同一模式，单条均应 < 30ms）
  const rangeParam = stampParams[1];
  const widgetSqls = [
    // A1 工具 TOP 榜
    [
      `SELECT tool, COUNT(*) AS calls, SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM events e JOIN sessions s ON s.id = e.session_id
       WHERE s.data_source = ? AND e.tool IS NOT NULL AND s.started_at >= ?
       GROUP BY tool ORDER BY calls DESC LIMIT 10`,
      ['scan', rangeParam],
    ],
    // A3 subagent 事件计数
    [
      `SELECT COUNT(*) AS n FROM events e JOIN sessions s ON s.id = e.session_id
       WHERE s.data_source = ? AND e.kind = 'agent' AND s.started_at >= ?`,
      ['scan', rangeParam],
    ],
    // A4 活跃热力图（tz 偏移在 SQL 里做）
    [
      `SELECT (CAST((julianday(s.started_at) * 1440 + ?) AS INTEGER) / 60) % 24 AS hour,
              COUNT(*) AS n FROM sessions s
       WHERE s.data_source = ? AND s.started_at >= ? GROUP BY hour`,
      [TZ, 'scan', rangeParam],
    ],
    // A7 会话活跃曲线
    [
      `SELECT substr(datetime(s.started_at, ?), 1, 13) AS hour,
              COUNT(DISTINCT s.id) AS sessions, SUM(s.message_count) AS messages
       FROM sessions s WHERE s.data_source = ? AND s.started_at >= ? GROUP BY hour`,
      [`+${TZ} minutes`, 'scan', rangeParam],
    ],
    // B4 工具失败率
    [
      `SELECT e.tool, COUNT(*) AS attempts, SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM events e JOIN sessions s ON s.id = e.session_id
       WHERE s.data_source = ? AND e.tool IS NOT NULL AND s.started_at >= ?
       GROUP BY e.tool ORDER BY attempts DESC LIMIT 10`,
      ['scan', rangeParam],
    ],
    // B14 任务纵深直方图
    [
      `SELECT CASE WHEN m.tool_call_count = 0 THEN '0'
                   WHEN m.tool_call_count <= 5 THEN '1-5'
                   WHEN m.tool_call_count <= 15 THEN '6-15'
                   WHEN m.tool_call_count <= 40 THEN '16-40'
                   ELSE '41+' END AS bucket, COUNT(*) AS n
       FROM metrics m JOIN sessions s ON s.id = m.session_id
       WHERE s.data_source = ? AND s.started_at >= ? GROUP BY bucket`,
      ['scan', rangeParam],
    ],
    // C1 采集健康：scan_state 正向断言 + provider 计数
    [`SELECT COUNT(*) AS c FROM scan_state`, []],
    [`SELECT provider, COUNT(*) AS n FROM sessions WHERE data_source = ? GROUP BY provider`, ['scan']],
    // C3 任务日历
    [
      `SELECT substr(datetime(s.started_at, ?), 1, 10) AS day,
              COUNT(DISTINCT s.id) AS sessions,
              MAX(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) AS has_error
       FROM sessions s WHERE s.data_source = ? AND s.started_at >= ? GROUP BY day`,
      [`+${TZ} minutes`, 'scan', rangeParam],
    ],
  ];

  // 冷路径：stamp + 全部 widget SQL
  const cold = performance.now();
  const stamp = db.prepare(stampSql).get(...stampParams);
  const widgetTimes = [];
  for (const [sql, params] of widgetSqls) {
    const t = performance.now();
    db.prepare(sql).all(...params);
    widgetTimes.push(performance.now() - t);
  }
  const coldMs = performance.now() - cold;

  // 缓存命中路径：只跑 stamp 判定
  const hit = performance.now();
  db.prepare(stampSql).get(...stampParams);
  const hitMs = performance.now() - hit;

  const worstWidget = Math.max(...widgetTimes);
  console.log(`mission 冷启（stamp + ${widgetSqls.length} 条 widget SQL）: ${coldMs.toFixed(2)} ms, stamp=${String(stamp.stamp).slice(0, 19)}`);
  console.log(`mission 缓存命中（仅 stamp 判定）: ${hitMs.toFixed(3)} ms`);
  console.log(`mission 单 widget SQL 最差: ${worstWidget.toFixed(3)} ms`);
  console.log('预算：冷启 < 500ms，命中 < 20ms，单 widget SQL < 30ms');
  if (coldMs >= 500 || hitMs >= 20 || worstWidget >= 30) {
    console.error('✗ mission 性能预算未达标');
    process.exitCode = 1;
  }
} finally {
  fixture.cleanup();
}
