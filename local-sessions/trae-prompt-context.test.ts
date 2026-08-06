import { describe, expect, it } from 'vitest';

import { buildTraePromptContextDraft, parseTraeModelConfig } from './trae-prompt-context.js';

function envelope(...sections: string[]): string {
  return JSON.stringify({
    raw_messages: [{
      role: 'user',
      content: [{ type: 'text', text: `${sections.map((s) => `<system-reminder>${s}</system-reminder>`).join('\n')}<user_input>6666</user_input>` }],
    }],
  });
}

describe('Trae Prompt Context 提取', () => {
  it('拆分、分类、脱敏并标记重复 reminder', () => {
    const repeated = 'Available skills: browser. Use <user_input> after checking skills.';
    const result = buildTraePromptContextDraft({
      userMessageRaw: envelope(
        'Terminal command status for /Users/alice/private is ready.',
        'API key sk-abcdefghijklmnopqrstuvwxyz123456 is configured.',
        repeated,
        repeated,
      ),
      turnContext: JSON.stringify({
        locale: 'en',
        persist_user_message_context: {
          model_info: {
            model_name: 'glm-5.2__dev',
            config_name: 'glm-5.2',
            prompt_max_tokens: 100000,
            max_tokens: 16000,
            max_turn: 70,
            is_preset: true,
            base_url: 'https://must-not-leak.example',
            auth_type: 'secret',
            extra_config: { feature_a: true, feature_b: false },
          },
        },
      }),
      capturedAt: '2026-08-06T00:00:00.000Z',
      agentType: 'builder',
      agentName: 'Builder',
    });

    expect(result).not.toBeNull();
    expect(result?.completeness).toBe('dynamic_only');
    expect(result?.fullSystemPrompt).toBeNull();
    expect(result?.dynamicSections).toHaveLength(4);
    expect(result?.dynamicSections[0]?.category).toBe('terminal');
    expect(result?.dynamicSections[0]?.content).toContain('/home/***');
    expect(result?.dynamicSections[1]?.content).toContain('sk-***');
    expect(result?.dynamicSections[3]?.duplicateOf).toBe('reminder-3');
    expect(result?.analysis.duplicateSectionCount).toBe(1);
    expect(result?.analysis.uniqueSectionCount).toBe(3);
    expect(result?.modelConfig).toMatchObject({
      modelName: 'glm-5.2__dev',
      configName: 'glm-5.2',
      promptMaxTokens: 100000,
      maxOutputTokens: 16000,
      maxTurns: 70,
      enabledFeatures: ['feature_a'],
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(JSON.stringify(result)).not.toContain('auth_type');
  });

  it('没有 reminder 时不产生伪 Prompt Context', () => {
    const result = buildTraePromptContextDraft({
      userMessageRaw: JSON.stringify({ raw_messages: [{ role: 'user', content: 'hello' }] }),
      turnContext: '{}',
      capturedAt: '2026-08-06T00:00:00.000Z',
    });
    expect(result).toBeNull();
  });

  it('损坏 context 仍返回安全的空模型配置', () => {
    expect(parseTraeModelConfig('{broken', { agentType: 'builder' })).toEqual({
      modelName: null,
      configName: null,
      promptMaxTokens: null,
      maxOutputTokens: null,
      maxTurns: null,
      isPreset: null,
      locale: null,
      agentType: 'builder',
      agentName: null,
      enabledFeatures: [],
    });
  });
});
