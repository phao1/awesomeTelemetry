import { describe, expect, it } from 'vitest';

import { EN, ZH, errorMessage, t } from './i18n.js';

describe('REQ-010 i18n', () => {
  it('zh/en 键完全对齐', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH).sort());
  });

  it('t() 返回对应语言文案', () => {
    expect(t('view.session', 'zh')).toBe('会话');
    expect(t('view.session', 'en')).toBe('Sessions');
  });

  it('错误码映射', () => {
    expect(errorMessage('SESSION_NOT_FOUND', 'zh')).toBe('会话不存在');
    expect(errorMessage('SESSION_NOT_FOUND', 'en')).toBe('Session not found');
    expect(errorMessage('UNKNOWN_CODE', 'zh')).toBe('UNKNOWN_CODE');
  });
});
