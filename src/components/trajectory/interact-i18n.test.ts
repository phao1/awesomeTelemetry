import { describe, expect, it } from 'vitest';

import { ti } from './interact-i18n.js';

describe('interact-i18n', () => {
  it('zh/en keys resolve', () => {
    expect(ti('spawn', 'zh')).toBe('派发');
    expect(ti('spawn', 'en')).toBe('spawn');
    expect(ti('timing', 'en')).toBe('Timing overview');
  });
});
