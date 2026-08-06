import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionPromptContext } from '../core/trace-types.js';
import { ApiError } from '../api/client.js';
import { PromptContextModal } from './PromptContextModal.js';

const SAMPLE: SessionPromptContext = {
  sessionId: 'trae-s1', provider: 'trae', source: 'trae_db', completeness: 'dynamic_only',
  capturedAt: '2026-08-06T00:00:00.000Z',
  dynamicSections: [
    { id: 'reminder-1', category: 'terminal', title: 'Terminal state', content: 'terminal ready', chars: 14, estimatedTokens: 4, duplicateOf: null },
    { id: 'reminder-2', category: 'terminal', title: 'Terminal state', content: 'terminal ready', chars: 14, estimatedTokens: 4, duplicateOf: 'reminder-1' },
  ],
  modelConfig: { modelName: 'glm-5.2__dev', configName: 'glm-5.2', promptMaxTokens: 100000, maxOutputTokens: 16000, maxTurns: 70, isPreset: true, locale: 'zh', agentType: 'builder', agentName: 'Builder', enabledFeatures: ['skill_tool'] },
  analysis: { totalChars: 28, estimatedTokens: 7, sectionCount: 2, uniqueSectionCount: 1, duplicateSectionCount: 1, duplicateChars: 14, contextWindowPercent: 0.007 },
  fullSystemPrompt: null,
};

async function render(load: (key: string) => Promise<SessionPromptContext>): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <PromptContextModal sessionKey="trae-s1" locale="zh" onClose={() => undefined} load={load} />,
    );
    await Promise.resolve();
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PromptContextModal', () => {
  it('先展示来源/完整性，再展示模型、分析和重复 section', async () => {
    const load = vi.fn(async () => SAMPLE);
    const container = await render(load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('仅动态上下文');
    expect(container.textContent).toContain('未捕获完整静态 System Prompt');
    expect(container.textContent).toContain('glm-5.2__dev');
    expect(container.textContent).toContain('重复于 reminder-1');
    expect(container.textContent).toContain('terminal ready');
  });

  it('PROMPT_CONTEXT_NOT_FOUND 显示可解释 empty state', async () => {
    const container = await render(async () => {
      throw new ApiError('PROMPT_CONTEXT_NOT_FOUND', 'missing', 404);
    });
    expect(container.textContent).toContain('该会话暂无 Prompt 上下文');
    expect(container.textContent).toContain('重新扫描');
  });

  it('其他失败显示错误码与 retry', async () => {
    const container = await render(async () => {
      throw new ApiError('INTERNAL_ERROR', 'boom', 500);
    });
    expect(container.textContent).toContain('INTERNAL_ERROR');
    expect(container.textContent).toContain('boom');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
