import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.js';
import { ArchitectureReadError } from './ArchitectureReadError.js';
import { ArchitectureCompare } from './ArchitectureCompare.js';
it.each([
  ['SOURCE_CHANGED', '记录发生变化', 'changed', true],
  ['UNINDEXED', '执行轨迹加载详情', 'execution trajectory to load details', false],
  ['TOO_LARGE', '减少任务数量', 'Select fewer', false],
  ['NO_MATCH', '已采集根任务', 'collected root tasks', false],
  ['INVALID_SOURCE', '日志格式无法解析', 'could not be parsed', false],
  ['UNEXPECTED', '服务端诊断', 'server diagnostics', true],
] as const)('localizes %s without displaying backend prose', async (reason, zh, en, canRetry) => {
  const host = document.createElement('div'), root = createRoot(host), retry = vi.fn();
  try {
    for (const locale of ['zh', 'en'] as const) {
      await act(async () => root.render(<ArchitectureReadError error={new ApiError('BAD_REQUEST', 'SECRET_SERVER_ENGLISH', 422, { reason, bytes: 600 * 1024 * 1024, limit: 512 * 1024 * 1024 })} locale={locale} retry={retry} />));
      expect(host.textContent).toContain(locale === 'zh' ? zh : en);
      expect(host.textContent).not.toContain('SECRET_SERVER_ENGLISH');
      expect(Boolean(host.querySelector('button'))).toBe(canRetry);
      if (canRetry) { await act(async () => host.querySelector('button')!.click()); expect(retry).toHaveBeenCalled(); }
      if (reason === 'TOO_LARGE') expect(host.textContent).toContain('600.0 / 512.0 MiB');
    }
  } finally { act(() => root.unmount()); }
});
it('preserves reason details through the comparison API and read hook and localizes close/retry', async () => {
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  const fetcher = vi.fn(async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'SECRET_SERVER_ENGLISH', details: { reason: 'SOURCE_CHANGED' } } }) }));
  vi.stubGlobal('fetch', fetcher);
  try {
    await act(async () => root.render(<ArchitectureCompare a={['collected:a']} b={['collected:b']} locale="en" onLocate={() => {}} onClose={() => {}} />));
    expect(host.textContent).toContain('Local records changed');
    expect(host.textContent).toContain('Close');
    expect(host.textContent).not.toContain('SECRET_SERVER_ENGLISH');
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Retry')!.click());
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it.each([['bytes', 155189248, 536870912, '148.0 / 512.0 MiB'], ['events', 25001, 20000, '25,001 / 20,000 events'], ['spans', 1234567, 2000, '1,234,567 / 2,000 spans']] as const)('formats %s size and limit in both locales', async (unit, value, limit, expected) => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    for (const locale of ['en', 'zh'] as const) {
      await act(async () => root.render(<ArchitectureReadError error={new ApiError('BAD_REQUEST', 'PRIVATE_MESSAGE', 413, { reason: 'TOO_LARGE', [unit]: value, limit })} locale={locale} retry={() => {}} />));
      expect(host.textContent).toContain(expected);
      expect(host.textContent).not.toContain('PRIVATE_MESSAGE');
    }
  } finally { act(() => root.unmount()); }
});
