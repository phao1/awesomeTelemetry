import { afterEach, describe, expect, it } from 'vitest';

import {
  LAYOUT_KEYS,
  LAYOUT_RANGES,
  loadBool,
  loadNumber,
  storeBool,
  storeNumber,
} from './layout.js';

afterEach(() => {
  localStorage.clear();
});

describe('REQ-026 布局持久化', () => {
  it('loadNumber：脏值回落默认，越界值钳制到范围', () => {
    localStorage.setItem(LAYOUT_KEYS.railWidth, 'not-a-number');
    expect(loadNumber(LAYOUT_KEYS.railWidth, 300, LAYOUT_RANGES.railWidth)).toBe(300);

    localStorage.setItem(LAYOUT_KEYS.railWidth, '9999');
    expect(loadNumber(LAYOUT_KEYS.railWidth, 300, LAYOUT_RANGES.railWidth)).toBe(480);

    localStorage.setItem(LAYOUT_KEYS.railWidth, '10');
    expect(loadNumber(LAYOUT_KEYS.railWidth, 300, LAYOUT_RANGES.railWidth)).toBe(260);

    localStorage.setItem(LAYOUT_KEYS.railWidth, '350');
    expect(loadNumber(LAYOUT_KEYS.railWidth, 300, LAYOUT_RANGES.railWidth)).toBe(350);
  });

  it('loadBool：非布尔值回落默认', () => {
    localStorage.setItem(LAYOUT_KEYS.railCollapsed, 'true');
    expect(loadBool(LAYOUT_KEYS.railCollapsed, false)).toBe(true);
    localStorage.setItem(LAYOUT_KEYS.railCollapsed, 'garbage');
    expect(loadBool(LAYOUT_KEYS.railCollapsed, false)).toBe(false);
  });

  it('storeNumber / storeBool 往返', () => {
    storeNumber(LAYOUT_KEYS.fontSize, 18.4);
    expect(localStorage.getItem(LAYOUT_KEYS.fontSize)).toBe('18');
    storeBool(LAYOUT_KEYS.inspectorCollapsed, true);
    expect(localStorage.getItem(LAYOUT_KEYS.inspectorCollapsed)).toBe('true');
  });
});
