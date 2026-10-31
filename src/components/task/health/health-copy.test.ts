import { expect, it } from 'vitest';
import { healthCopy, healthProse } from './health-copy.js';
it('keeps locale keys aligned and selects saved bilingual recommendation prose', () => {
  expect(Object.keys(healthCopy('zh'))).toEqual(Object.keys(healthCopy('en')));
  expect(Object.values(healthCopy('en')).every(Boolean)).toBe(true);
  expect(healthProse('日志代理 / Log proxy', 'en')).toBe('Log proxy');
  expect(healthProse('日志代理 / Log proxy', 'zh')).toBe('日志代理');
});
