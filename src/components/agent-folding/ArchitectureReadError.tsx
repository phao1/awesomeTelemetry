import { ApiError } from '../../api/client.js';
import type { Locale } from '../../i18n.js';
export function ArchitectureReadError({ error, locale, retry }: { error: unknown; locale: Locale; retry: () => void }) {
  const zh = locale === 'zh', details = error instanceof ApiError ? error.details : undefined;
  const codeReason=error instanceof ApiError?({SOURCE_CHANGED:'SOURCE_CHANGED',SESSION_NOT_FOUND:'NO_MATCH',HEALTH_SOURCE_CHANGED:'SOURCE_CHANGED',HEALTH_BUSY:'BUSY',BUSY:'BUSY',HEALTH_TIMEOUT:'TIMEOUT',HEALTH_INPUT_LIMIT:'TOO_LARGE'} as Record<string,string>)[error.code]:undefined;
  const reason = details?.reason ?? codeReason ?? (error === 'READ_TIMEOUT' ? 'TIMEOUT' : 'UNEXPECTED');
  const text = {
    SOURCE_CHANGED: zh ? '读取期间本地记录发生变化，请重试。' : 'Local records changed during reading. Retry.',
    UNINDEXED: zh ? '委派记录尚未索引。请打开该任务的执行轨迹加载详情，然后重试架构读取。' : 'Delegation records are not indexed. Open the task execution trajectory to load details, then retry Architecture.',
    TOO_LARGE: zh ? '所选任务超过读取上限，请减少任务数量或选择更小的任务。' : 'The selection exceeds the read limit. Select fewer or smaller tasks.',
    NO_MATCH: zh ? '没有匹配的任务。请选择同一工具的已采集根任务，并检查目录和时间范围。' : 'No matching tasks. Select collected root tasks from one provider and check directory and time filters.',
    INVALID_SOURCE: zh ? '本地日志格式无法解析。请重新扫描本地记录并检查日志是否完整。' : 'Local logs could not be parsed. Rescan local records and check log integrity.',
    TIMEOUT: zh ? '读取超时，请缩小选择后重试。' : 'Reading timed out. Narrow the selection and retry.',
    BUSY: zh ? '已有读取任务正在运行，请稍后重试。' : 'A read is already running. Retry shortly.',
    UNEXPECTED: zh ? '架构读取暂时失败，请重试；若持续失败，请查看服务端诊断。' : 'Architecture could not be read. Retry; if it persists, check server diagnostics.',
  };
  const scale = ['bytes', 'events', 'spans', 'tasks', 'agents', 'boundaries', 'evidence', 'traffic'].find(k => typeof details?.[k] === 'number');
  const format = (n: number) => scale === 'bytes' ? (n / (1024 * 1024)).toFixed(1) : n.toLocaleString(zh ? 'zh-CN' : 'en-US');
  const size = scale && typeof details?.limit === 'number' ? ` ${zh ? '规模 / 上限' : 'Size / limit'}: ${format(details[scale] as number)} / ${format(details.limit)} ${scale === 'bytes' ? 'MiB' : scale}` : '';
  return <p role="alert">{text[reason as keyof typeof text] ?? text.UNEXPECTED}{size} {['SOURCE_CHANGED', 'TIMEOUT', 'BUSY', 'UNEXPECTED'].includes(String(reason)) && <button className="btn" onClick={retry}>{zh ? '重试' : 'Retry'}</button>}</p>;
}
