import { useEffect, useMemo, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  ProviderKey,
  SessionDetailResponse,
  TraceRecord,
} from '../core/trace-types.js';
import { extractTokenTexts } from '../core/token-breakdown.js';
import { recordCache } from '../cache/caches.js';
import { api } from '../api/client.js';
import { Modal } from './ui/Modal.js';
import { ProviderBadge } from './ui/Badge.js';
import { ErrorState, Skeleton } from './ui/States.js';
import { countMatches, highlightMatches } from './inspector-text.js';
import { IconSearch, IconSuccess, IconWarning } from './icons/index.js';

export type TokenClass = 'system' | 'input' | 'output' | 'reasoning';

export interface TokenTextModalProps {
  sessionKey: string;
  provider: ProviderKey;
  /** 会话标题 / agent 名（Header 展示）。 */
  agentName: string;
  tokenClass: TokenClass;
  tokenCount: number;
  locale: Locale;
  onClose: () => void;
  /** 测试注入；缺省走 api.sessionDetail(key, 'full') 并写 recordCache。 */
  loadFull?: (key: string) => Promise<SessionDetailResponse>;
}

/** 截断阈值（REQ-101）。 */
export const TOKEN_TEXT_LIMIT = 10_000;

/** REQ-116：正文超过该长度才提供面板内搜索。 */
export const TOKEN_TEXT_SEARCH_MIN = 500;

/**
 * REQ-101：Token 文本 drill-down。
 * - 复用 recordCache（G-UI-2）：full 命中直接展示；system 段可用 slim 的
 *   systemPrompt（slim 详情已返回正文），避免多余请求；其余段 miss 时
 *   懒加载 `mode=full` 一次并写缓存。
 * - 文本缺失显示 `--attention-subtle` 警告 banner。
 * - 超 10000 字符截断 + "Show all"；复制按钮 2 秒 IconSuccess 反馈。
 */
export function TokenTextModal({
  sessionKey,
  provider,
  agentName,
  tokenClass,
  tokenCount,
  locale,
  onClose,
  loadFull,
}: TokenTextModalProps): React.JSX.Element {
  const [record, setRecord] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  // REQ-116：面板内搜索（与 EventInspector 同一套快捷键 / 高亮 / 导航）。
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLPreElement | null>(null);

  const resolve = (loader: (key: string) => Promise<SessionDetailResponse>): void => {
    const full = recordCache.get(`${sessionKey}:full`);
    if (full !== undefined) {
      setRecord(full);
      setLoading(false);
      return;
    }
    const slim = recordCache.get(`${sessionKey}:slim`);
    // system 正文在 slim 详情里已返回，无需为了 system 段发 full 请求。
    if (slim !== undefined && tokenClass === 'system') {
      setRecord(slim);
      setLoading(false);
      return;
    }
    setLoading(true);
    void loader(sessionKey)
      .then((loaded) => {
        recordCache.set(`${sessionKey}:full`, loaded);
        setRecord(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        console.error('[token-modal] 全文加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    resolve(loadFull ?? ((key: string) => api.sessionDetail(key, 'full')));
  }, [sessionKey, tokenClass, loadFull]);

  const texts = useMemo(
    () => (record === null ? null : extractTokenTexts(record as unknown as TraceRecord)),
    [record],
  );
  const text = texts === null ? null : texts[tokenClass];
  const charCount = text?.length ?? 0;
  const missing = record !== null && text === null;
  const isSystemMissing = tokenClass === 'system' && record !== null && record.session.systemPrompt === null;
  const truncated = charCount > TOKEN_TEXT_LIMIT;
  const shown = text === null ? '' : truncated && !showAll ? text.slice(0, TOKEN_TEXT_LIMIT) : text;
  const searchable = charCount > TOKEN_TEXT_SEARCH_MIN;
  const matchCount = useMemo(() => countMatches(shown, findQuery), [shown, findQuery]);
  const hasQuery = findQuery.trim() !== '';
  const noMatches = hasQuery && matchCount === 0;

  // REQ-116：Ctrl/⌘+F 打开搜索框并聚焦（仅在正文足够长时接管）。
  useEffect(() => {
    if (!searchable) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchable]);

  // 查询变化时重置到第一个匹配。
  useEffect(() => {
    setActiveMatch(0);
  }, [findQuery, shown]);

  // 当前匹配滚动到可视区。
  useEffect(() => {
    if (!hasQuery || matchCount === 0) {
      return;
    }
    bodyRef.current?.querySelector('.inspector-find-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeMatch, hasQuery, matchCount]);

  const stepMatch = (delta: 1 | -1): void => {
    if (matchCount === 0) {
      return;
    }
    setActiveMatch((prev) => (prev + delta + matchCount) % matchCount);
  };

  const retry = (): void => {
    setError(null);
    setRecord(null);
    setLoading(true);
    resolve(loadFull ?? ((key: string) => api.sessionDetail(key, 'full')));
  };

  const copy = (): void => {
    if (text === null) {
      return;
    }
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch((err: unknown) => {
        console.error('[token-modal] 复制失败:', err);
      });
  };

  return (
    <Modal
      title={t('token.modal.title', locale)}
      onClose={onClose}
      size="lg"
    >
      <div className="token-modal" data-token-class={tokenClass}>
        <header className="token-modal-header">
          <ProviderBadge provider={provider} locale={locale} />
          <span className="token-modal-agent">{agentName}</span>
          <span className="token-modal-class">{t(`compare.charts.tokenClass.${tokenClass}`, locale)}</span>
          <span className="mono token-modal-stat">
            {tokenCount.toLocaleString()} {t('token.modal.tokens', locale)}
          </span>
          <span className="mono token-modal-stat">
            {charCount.toLocaleString()} {t('token.modal.chars', locale)}
          </span>
          <span className="spacer" />
          {searchable && (
            <button
              type="button"
              className="ui-icon-btn ui-btn-sm"
              aria-label={t('inspector.find', locale)}
              aria-expanded={findOpen}
              title={t('inspector.find', locale)}
              onClick={() => {
                setFindOpen((prev) => !prev);
                window.setTimeout(() => findInputRef.current?.focus(), 0);
              }}
            >
              <IconSearch size={16} />
            </button>
          )}
          <button type="button" className="btn ui-btn-sm" onClick={copy} disabled={text === null}>
            {copied ? <IconSuccess size={16} /> : null}
            {copied ? t('token.modal.copied', locale) : t('token.modal.copy', locale)}
          </button>
        </header>
        {searchable && findOpen && (
          <div className="inspector-find token-modal-find">
            <input
              ref={findInputRef}
              type="search"
              className={`inspector-find-input ${noMatches ? 'inspector-find-input-empty' : ''}`}
              placeholder={t('inspector.find', locale)}
              aria-label={t('inspector.find', locale)}
              aria-invalid={noMatches}
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  stepMatch(e.shiftKey ? -1 : 1);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setFindOpen(false);
                  setFindQuery('');
                }
              }}
            />
            <span className="mono inspector-find-count">
              {!hasQuery
                ? ''
                : matchCount > 0
                  ? t('token.modal.matchNav', locale)
                      .replace('{x}', String(activeMatch + 1))
                      .replace('{y}', String(matchCount))
                  : t('inspector.noMatches', locale)}
            </span>
          </div>
        )}
        {loading && record === null && <Skeleton variant="block" count={3} />}
        {error !== null && (
          <ErrorState
            code="TOKEN_TEXT_LOAD_FAILED"
            message={error}
            onRetry={retry}
          />
        )}
        {!loading && error === null && record !== null && missing && (
          <div className="token-modal-warning" role="status">
            <IconWarning size={16} />
            {isSystemMissing
              ? t('token.modal.missingSystem', locale)
              : t('token.modal.missing', locale)}
          </div>
        )}
        {!loading && error === null && record !== null && text !== null && (
          <div className="token-modal-body">
            <pre className="mono token-modal-text" ref={bodyRef}>
              {hasQuery ? highlightMatches(shown, findQuery, activeMatch) : shown}
            </pre>
            {truncated && (
              <button
                type="button"
                className="token-modal-showall"
                onClick={() => setShowAll((prev) => !prev)}
              >
                {showAll
                  ? t('token.modal.collapse', locale)
                  : t('token.modal.showAll', locale).replace(
                      '{n}',
                      (charCount - TOKEN_TEXT_LIMIT).toLocaleString(),
                    )}
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
