import { useState } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { TraceEvent, TurnMessage } from '../../core/trace-types.js';
import { resolveToolRenderer } from './renderers/index.js';
import { IconCopy, IconSuccess, IconTool } from '../icons/index.js';

export interface ToolCallBlockProps {
  /** D4/D5：回合内的一条 tool 消息；`eventId` 即原生调用 id，原样展示。 */
  message: TurnMessage;
  sessionKey: string;
  locale: Locale;
  /** full-tier 事件（assistant 卡展开时随成员一起拉取，LRU 缓存）。 */
  detail: TraceEvent | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/**
 * D5：原生调用 id 的形态 —— claude `toolu_…`、codex `call_00_…`、
 * codearts `msg_…`。其余形态视为非调用形，回退展示 `#sequence`。
 * 绝不解析 / 重排 / 截断（DOM 层可视觉截断但完整值可复制）。
 */
export function isCallShapedId(id: string): boolean {
  return /^(toolu_|call_|msg_)/.test(id);
}

/**
 * D4/D5：工具调用块 —— 嵌套在 assistant 卡内，展示工具名、原生调用 id、
 * 参数（renderArguments）。颜色与图标 + 名称同时出现；id 是 `event.id`
 * 原样（C7：不新增 toolCallId 字段、不生成 id）。
 */
export function ToolCallBlock({
  message,
  locale,
  detail,
  loading,
  error,
  onRetry,
}: ToolCallBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const idLabel = isCallShapedId(message.eventId)
    ? message.eventId
    : t('trajectory.callId.fallback', locale);

  const copyId = (): void => {
    void navigator.clipboard
      ?.writeText(message.eventId)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch((err: unknown) => {
        console.error('[tool-call] 复制失败:', err);
      });
  };

  const argsText = detail?.inputSummary ?? null;
  const renderer = resolveToolRenderer(message.tool);
  const rendered =
    argsText !== null && renderer !== null ? renderer.renderArguments(argsText) : null;

  return (
    <div className="tool-call-block">
      <div className="tool-call-block-header">
        <span className="tool-call-block-name">
          <IconTool size={12} />
          {message.tool ?? t('trajectory.role.tool', locale)}
        </span>
        <span className="tool-call-block-id mono" title={message.eventId}>
          {idLabel}
        </span>
        <button
          type="button"
          className="ui-icon-btn ui-btn-sm"
          aria-label={t('trajectory.card.copy', locale)}
          title={t('trajectory.card.copy', locale)}
          onClick={copyId}
        >
          {copied ? <IconSuccess size={12} /> : <IconCopy size={12} />}
        </button>
      </div>
      {error !== null && (
        <div className="tool-call-block-args">
          <button type="button" className="btn ui-btn-sm" onClick={onRetry}>
            {t('trajectory.card.retry', locale)}
          </button>
        </div>
      )}
      {error === null && loading && (
        <div className="tool-call-block-args">
          <span className="hint">{t('trajectory.card.loading', locale)}</span>
        </div>
      )}
      {error === null && !loading && argsText === null && (
        <div className="tool-call-block-args">
          <span className="message-card-empty">{t('trajectory.toolResult.empty', locale)}</span>
        </div>
      )}
      {error === null && !loading && rendered !== null && (
        <div className="tool-call-block-args">{rendered.kind === 'ok' ? rendered.node : null}</div>
      )}
      {error === null &&
        !loading &&
        argsText !== null &&
        (rendered === null || rendered.kind === 'fallback') && (
          <div className="tool-call-block-args">
            {rendered?.kind === 'fallback' && (
              <span className="message-card-raw-marker">{t('trajectory.rawMarker', locale)}</span>
            )}
            <pre className="mono">{argsText}</pre>
          </div>
        )}
    </div>
  );
}
