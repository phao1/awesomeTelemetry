import { useEffect, useState } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { SessionAnnotations, SessionAnnotationsUpdate } from '../../core/trace-types.js';
import { api, ApiError } from '../../api/client.js';
import { ErrorState, Skeleton, Toast, type ToastTone } from '../ui/States.js';
import { IconClose, IconPlus } from '../icons/index.js';

export interface AnnotationsPanelProps {
  locale: Locale;
  sessionKey: string;
  /** 测试注入：默认走 api（D16：detail 打开时恰好一次 annotations 请求）。 */
  fetchAnnotations?: (key: string) => Promise<SessionAnnotations>;
  saveAnnotations?: (key: string, update: SessionAnnotationsUpdate) => Promise<SessionAnnotations>;
}

interface PanelToast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

const defaultFetchAnnotations = (key: string): Promise<SessionAnnotations> =>
  api.sessionAnnotations(key);
const defaultSaveAnnotations = (
  key: string,
  update: SessionAnnotationsUpdate,
): Promise<SessionAnnotations> => api.saveSessionAnnotations(key, update);

let toastSequence = 0;

/**
 * D13 注解面板：标签增删即时持久化；备注仅显式保存（未变化时禁用）；
 * 成功 / 失败都弹 Toast，失败携带 ApiError 的 code 且不清空其余标签。
 * 从未注解的会话渲染空标签 + 空备注，不是错误态（D13 GET 空形状）。
 */
export function AnnotationsPanel({
  locale,
  sessionKey,
  fetchAnnotations = defaultFetchAnnotations,
  saveAnnotations = defaultSaveAnnotations,
}: AnnotationsPanelProps): React.JSX.Element {
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [persistedNote, setPersistedNote] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [toast, setToast] = useState<PanelToast | null>(null);

  const showToast = (tone: ToastTone, title: string, message?: string): void => {
    toastSequence += 1;
    setToast({ id: toastSequence, tone, title, message });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchAnnotations(sessionKey)
      .then((res) => {
        if (cancelled) {
          return;
        }
        setTags(res.tags);
        setNote(res.note ?? '');
        setPersistedNote(res.note ?? '');
      })
      .catch((err: unknown) => {
        console.error('[annotations] 读取失败:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey, fetchAnnotations]);

  const errorCode = (err: unknown): string =>
    err instanceof ApiError ? err.code : err instanceof Error ? err.message : String(err);

  const addTag = (): void => {
    const raw = tagInput.trim();
    if (raw === '') {
      return;
    }
    const next = [...tags, raw];
    void saveAnnotations(sessionKey, { tags: next })
      .then((res) => {
        setTags(res.tags);
        setTagInput('');
        showToast('success', t('trajectory.annotations.tagSaved', locale));
      })
      .catch((err: unknown) => {
        console.error('[annotations] 标签保存失败:', err);
        // D13：失败不清空其余标签；输入保留便于修正。
        showToast('error', t('trajectory.annotations.tagError', locale), errorCode(err));
      });
  };

  const removeTag = (tag: string): void => {
    const next = tags.filter((value) => value !== tag);
    void saveAnnotations(sessionKey, { tags: next })
      .then((res) => setTags(res.tags))
      .catch((err: unknown) => {
        console.error('[annotations] 标签删除失败:', err);
        showToast('error', t('trajectory.annotations.tagError', locale), errorCode(err));
      });
  };

  const saveNote = (): void => {
    if (note === persistedNote) {
      return;
    }
    setSavingNote(true);
    void saveAnnotations(sessionKey, { note })
      .then((res) => {
        setNote(res.note ?? '');
        setPersistedNote(res.note ?? '');
        showToast('success', t('trajectory.annotations.saveSuccess', locale));
      })
      .catch((err: unknown) => {
        console.error('[annotations] 备注保存失败:', err);
        showToast('error', t('trajectory.annotations.saveError', locale), errorCode(err));
      })
      .finally(() => setSavingNote(false));
  };

  const retry = (): void => {
    setError(null);
    setLoading(true);
    void fetchAnnotations(sessionKey)
      .then((res) => {
        setTags(res.tags);
        setNote(res.note ?? '');
        setPersistedNote(res.note ?? '');
      })
      .catch((err: unknown) => {
        console.error('[annotations] 重试失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  };

  const noteDirty = note !== persistedNote;

  return (
    <section className="trajectory-rail-panel" aria-label={t('trajectory.annotations.title', locale)}>
      <h3 className="trajectory-rail-panel-title">
        <IconPlus size={12} />
        {t('trajectory.annotations.title', locale)}
      </h3>
      {loading && <Skeleton variant="row" count={3} />}
      {error !== null && (
        <ErrorState code="ANNOTATIONS_FAILED" message={error} onRetry={retry} />
      )}
      {!loading && error === null && (
        <>
          <div className="annotations-tags">
            {tags.map((tag) => (
              <span key={tag} className="annotation-tag">
                <span className="annotation-tag-name" title={tag}>
                  {tag}
                </span>
                <button
                  type="button"
                  className="annotation-tag-remove"
                  aria-label={t('trajectory.annotations.tags', locale)}
                  title={t('trajectory.annotations.tags', locale)}
                  onClick={() => removeTag(tag)}
                >
                  <IconClose size={12} />
                </button>
              </span>
            ))}
            {tags.length === 0 && (
              <span className="hint">{t('trajectory.annotations.empty', locale)}</span>
            )}
          </div>
          <div className="annotations-tag-input-row">
            <input
              type="text"
              className="annotations-tag-input"
              placeholder={t('trajectory.annotations.tagPlaceholder', locale)}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addTag();
                }
              }}
            />
            <button type="button" className="btn ui-btn-sm" onClick={addTag}>
              <IconPlus size={12} />
            </button>
          </div>
          <div className="annotations-note">
            <label className="trajectory-pill-label">
              {t('trajectory.annotations.note', locale)}
            </label>
            <textarea
              value={note}
              placeholder={t('trajectory.annotations.notePlaceholder', locale)}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="annotations-note-actions">
              <button
                type="button"
                className="btn ui-btn-sm"
                disabled={!noteDirty || savingNote}
                onClick={saveNote}
              >
                {savingNote
                  ? t('common.loading', locale)
                  : noteDirty
                    ? t('trajectory.annotations.save', locale)
                    : t('trajectory.annotations.saved', locale)}
              </button>
            </div>
          </div>
        </>
      )}
      {toast !== null && (
        <div className="annotations-toast">
          <Toast
            tone={toast.tone}
            title={toast.title}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </section>
  );
}
