/**
 * add-mission-control §5.2（A3）：从 `input_summary` 提取 subagent 类型。
 *
 * 真实数据形态未逐厂商核验（无法读取全部厂商会话文件），因此实现为
 * **防御式启发式**：优先解析 JSON 字段（subagentType / subagent_type /
 * type / kind / role），JSON 失败时在纯文本里找 `type:` / `subagent_type:`
 * 键值；都找不到返回 'unknown'（口径行已标注为启发式）。
 */

const JSON_KEYS = ['subagentType', 'subagent_type', 'type', 'kind', 'role'] as const;

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; // 非 JSON，调用方走文本启发式（G7.7：catch 必须有实际处理）
  }
}

export function extractSubagentType(inputSummary: string | null | undefined): string {
  const text = (inputSummary ?? '').trim();
  if (text === '') {
    return 'unknown';
  }
  const parsed = tryParseJson(text);
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of JSON_KEYS) {
      const value = obj[key];
      if (typeof value === 'string' && value !== '') {
        return value;
      }
    }
  }
  const keyMatch = /(?:subagent_type|subagentType|"type")\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i.exec(text);
  if (keyMatch !== null) {
    return keyMatch[1]!;
  }
  return 'unknown';
}
