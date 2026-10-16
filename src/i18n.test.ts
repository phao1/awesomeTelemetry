import { describe, expect, it } from 'vitest';

import { EN, ZH, errorMessage, t } from './i18n.js';

describe('REQ-010 i18n', () => {
  it('zh/en 键完全对齐', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH).sort());
  });

  it('t() 返回对应语言文案', () => {
    // UI 架构调整：Sessions 页签改名为「任务」/「Tasks」
    expect(t('view.session', 'zh')).toBe('任务');
    expect(t('view.session', 'en')).toBe('Tasks');
  });

  it('keeps original quota, metadata pressure, free disk and prior confirmed cleanup distinctions bilingual', () => {
    for (const locale of ['zh', 'en'] as const) {
      expect(t('proxy.capacity.title', locale)).not.toBe('');
      expect(t('proxy.capacity.remaining', locale)).not.toBe(t('proxy.capacity.combinedAdmission', locale));
      expect(t('proxy.capacity.pendingDeletion', locale)).not.toBe('');
      expect(t('proxy.capacity.sqliteFull', locale)).toContain('SQLITE_FULL');
    }
  });

  it('错误码映射', () => {
    expect(errorMessage('SESSION_NOT_FOUND', 'zh')).toBe('会话不存在');
    expect(errorMessage('SESSION_NOT_FOUND', 'en')).toBe('Session not found');
    expect(errorMessage('UNKNOWN_CODE', 'zh')).toBe('UNKNOWN_CODE');
  });
});
